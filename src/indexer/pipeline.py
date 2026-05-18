"""
Indexing pipeline: file → extract → embed → store (Qdrant + SQLite/FTS5).

Each file gets a stable doc_id derived from its absolute path so that
re-indexing cleanly replaces the old vectors and metadata.
"""
from __future__ import annotations
import hashlib
import logging
import threading
from pathlib import Path
from typing import Tuple

from app.watch_settings import get_watched_docs_dir
from indexer.extractor import extract, SUPPORTED_EXTENSIONS
from indexer.progress import set_progress, clear_progress
from app.services.embedder import embed
from app.services import qdrant_store as qs
from app.services.fts import (
    upsert_document,
    insert_chunks,
    delete_document,
    get_document_by_path,
    get_all_documents_mtimes,
)

logger = logging.getLogger(__name__)


# Per-path locks prevent concurrent index_file() on the same document, which
# would otherwise race on SQLite + Qdrant writes and (for large PDFs) blow up
# memory by running multiple embed() passes in parallel.
_path_locks: dict[str, threading.Lock] = {}
_path_locks_guard = threading.Lock()


def _lock_for(filepath: str) -> threading.Lock:
    with _path_locks_guard:
        lock = _path_locks.get(filepath)
        if lock is None:
            lock = threading.Lock()
            _path_locks[filepath] = lock
        return lock


# ── Helpers ───────────────────────────────────────────────────────────────────

def _doc_id(filepath: str) -> str:
    """Stable 16-char hex ID derived from the absolute file path."""
    return hashlib.sha256(filepath.encode()).hexdigest()[:16]


# ── Core indexing function ────────────────────────────────────────────────────

def index_file(path: Path, known_mtime: float | None = None) -> Tuple[bool, str]:
    """
    Index a single file.

    Parameters
    ----------
    known_mtime : float | None
        If supplied, treated as the currently-indexed mtime for *path*
        (skips the SQLite SELECT). Used by index_all for batched skip-checks.

    Returns
    -------
    (True,  "indexed")   — file was (re-)indexed successfully
    (False, "skipped")   — unchanged since last index
    (False, "error:<msg>") — extraction or storage failed
    """
    path = path.resolve()
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        return False, "unsupported"

    filepath = str(path)
    doc_id   = _doc_id(filepath)

    # Skip if already indexed and unmodified.
    # Prefer the caller-supplied mtime to avoid a per-file DB round-trip.
    existing_mtime: float | None
    if known_mtime is not None:
        existing_mtime = known_mtime
    else:
        existing = get_document_by_path(filepath)
        existing_mtime = existing["modified_at"] if existing else None

    if existing_mtime is not None:
        try:
            mtime = path.stat().st_mtime
            if abs(existing_mtime - mtime) < 1.0:
                logger.debug("Skipping (unchanged): %s", path.name)
                return False, "skipped"
        except OSError:
            pass

    lock = _lock_for(filepath)
    if not lock.acquire(blocking=False):
        logger.info("Skipping (already indexing): %s", path.name)
        return False, "busy"

    logger.info("Indexing: %s", path.name)
    try:
        set_progress(doc_id, 5)
        stat   = path.stat()
        chunks = extract(path)
        if not chunks:
            logger.warning("No content extracted from %s", path.name)
            return False, "empty"

        # Annotate each chunk with file metadata (stored in Qdrant payload)
        for chunk in chunks:
            chunk["filename"] = path.name
            chunk["filepath"] = filepath

        set_progress(doc_id, 40)
        texts   = [c["text"] for c in chunks]
        vectors = embed(texts)

        set_progress(doc_id, 80)
        # Atomically replace old data
        delete_document(doc_id)          # SQLite (cascade → chunks → FTS)
        qs.delete_doc(doc_id)            # Qdrant

        upsert_document(
            doc_id=doc_id,
            filepath=filepath,
            filename=path.name,
            file_size=stat.st_size,
            modified_at=stat.st_mtime,
        )
        insert_chunks(doc_id, chunks)
        qs.upsert_chunks(doc_id, chunks, vectors)

        logger.info("Indexed %s — %d chunks", path.name, len(chunks))
        return True, "indexed"

    except Exception as exc:
        logger.exception("Failed to index %s: %s", path.name, exc)
        return False, f"error:{exc}"
    finally:
        clear_progress(doc_id)
        lock.release()


def index_all(directory: Path | None = None) -> Tuple[int, int]:
    """
    Index all supported documents in *directory* (default: WATCHED_DOCS_DIR).

    Pre-loads all known {filepath: modified_at} in a single SQL query so the
    common "everything is up-to-date" case avoids N database round-trips.

    Returns (files_indexed, files_skipped).
    """
    directory = Path(directory or get_watched_docs_dir())
    mtime_cache = get_all_documents_mtimes()

    indexed = skipped = 0
    for path in directory.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        known = mtime_cache.get(str(path.resolve()))
        ok, _reason = index_file(path, known_mtime=known)
        if ok:
            indexed += 1
        else:
            skipped += 1
    return indexed, skipped
