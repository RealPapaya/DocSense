"""
Indexing pipeline: file → extract → embed → store (Qdrant + SQLite/FTS5).

Each file gets a stable doc_id derived from its absolute path so that
re-indexing cleanly replaces the old vectors and metadata.

``index_all()`` overlaps extraction (I/O bound) with embed + store (CPU bound)
using a single producer/consumer queue, so wall-clock time drops without
adding a second ONNX session (which would double the CPU footprint).
"""
from __future__ import annotations

import hashlib
import logging
import queue
import threading
from pathlib import Path
from typing import Iterable, List, Tuple

from app.watch_settings import get_watched_docs_dirs
from app.services.embedder import embed
from app.services import qdrant_store as qs
from app.services.fts import (
    upsert_document,
    insert_chunks,
    delete_document,
    get_document_by_path,
    get_all_documents_mtimes,
)
from indexer.extractor import extract, SUPPORTED_EXTENSIONS
from indexer import progress

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


def _is_junk_filename(name: str) -> bool:
    """Skip OS/Office artefacts that have supported extensions but aren't real docs.

    - ``~$foo.xlsx`` — Excel/Word lock files created while a document is open.
    - ``.~lock.foo.docx#`` — LibreOffice equivalent.
    - ``._foo.pdf`` — macOS resource-fork shadows on SMB shares.
    """
    return name.startswith("~$") or name.startswith("._") or name.startswith(".~lock.")


def _needs_index(path: Path, mtime_cache: dict[str, float]) -> bool:
    """Return True when *path* is missing or newer than what we have indexed.

    *path* is expected to be already :py:meth:`Path.resolve`-d so its string
    form matches whatever was written to ``documents.filepath``.
    """
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return False
    known = mtime_cache.get(str(path))
    if known is None:
        return True
    return abs(known - mtime) >= 1.0


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
    doc_id = _doc_id(filepath)

    # Skip if already indexed and unmodified.
    # Prefer the caller-supplied mtime to avoid a per-file DB round-trip.
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
        return _index_locked(path, doc_id, filepath)
    finally:
        lock.release()


def _index_locked(path: Path, doc_id: str, filepath: str) -> Tuple[bool, str]:
    """Body of index_file once the per-path lock is held."""
    try:
        progress.set_progress(doc_id, 5, phase="extract", filename=path.name)
        stat = path.stat()

        def _page_cb(done: int, total: int) -> None:
            # Extract uses 5..35% of the per-file bar.
            if total <= 0:
                return
            pct = 5 + int(30 * done / total)
            progress.set_progress(doc_id, pct, phase="extract")

        chunks = extract(path, on_page=_page_cb)
        if not chunks:
            logger.warning("No content extracted from %s", path.name)
            progress.clear_progress(doc_id)
            return False, "empty"

        for chunk in chunks:
            chunk["filename"] = path.name
            chunk["filepath"] = filepath

        progress.set_progress(doc_id, 40, phase="embed")
        texts = [c["text"] for c in chunks]

        def _embed_cb(done: int, total: int) -> None:
            # Embed uses 40..80% of the per-file bar.
            if total <= 0:
                return
            pct = 40 + int(40 * done / total)
            progress.set_progress(doc_id, pct, phase="embed")

        vectors = embed(texts, on_batch=_embed_cb)

        progress.set_progress(doc_id, 85, phase="store")
        delete_document(doc_id)          # SQLite cascades to chunks → FTS
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

        progress.mark_done(doc_id, filename=path.name)
        logger.info("Indexed %s — %d chunks", path.name, len(chunks))
        return True, "indexed"

    except Exception as exc:
        logger.exception("Failed to index %s: %s", path.name, exc)
        progress.clear_progress(doc_id)
        return False, f"error:{exc}"


# ── Bulk indexing with producer/consumer overlap ──────────────────────────────

# Each queue item carries the path plus its pre-extracted chunks. ``None`` is
# the sentinel that tells the consumer to exit.
_EXTRACT_FAILED = object()


def _extract_worker(
    todo: List[Path],
    q: "queue.Queue",
    stop: threading.Event,
) -> None:
    """Producer: extract text chunks and push them to the consumer."""
    for path in todo:
        if stop.is_set():
            break
        doc_id = _doc_id(str(path))
        try:
            progress.set_progress(doc_id, 5, phase="extract", filename=path.name)

            def _page_cb(done: int, total: int, _id=doc_id) -> None:
                if total <= 0:
                    return
                pct = 5 + int(30 * done / total)
                progress.set_progress(_id, pct, phase="extract")

            chunks = extract(path, on_page=_page_cb)
        except Exception as exc:
            logger.exception("Extraction failed for %s: %s", path.name, exc)
            progress.clear_progress(doc_id)
            q.put((path, _EXTRACT_FAILED, None))
            continue
        if not chunks:
            progress.clear_progress(doc_id)
            q.put((path, _EXTRACT_FAILED, None))
            continue
        stat = path.stat()
        for chunk in chunks:
            chunk["filename"] = path.name
            chunk["filepath"] = str(path)
        q.put((path, chunks, stat))
    q.put(None)


def _consume(
    path: Path,
    chunks: List[dict],
    stat,
) -> bool:
    """Consumer step: embed + store. Returns True on success."""
    filepath = str(path)
    doc_id = _doc_id(filepath)
    lock = _lock_for(filepath)
    if not lock.acquire(blocking=False):
        # A watchdog handler must already be re-indexing this file.
        progress.clear_progress(doc_id)
        return False
    try:
        progress.set_progress(doc_id, 40, phase="embed", filename=path.name)
        texts = [c["text"] for c in chunks]

        def _embed_cb(done: int, total: int, _id=doc_id) -> None:
            if total <= 0:
                return
            pct = 40 + int(40 * done / total)
            progress.set_progress(_id, pct, phase="embed")

        vectors = embed(texts, on_batch=_embed_cb)

        progress.set_progress(doc_id, 85, phase="store")
        delete_document(doc_id)
        qs.delete_doc(doc_id)
        upsert_document(
            doc_id=doc_id,
            filepath=filepath,
            filename=path.name,
            file_size=stat.st_size,
            modified_at=stat.st_mtime,
        )
        insert_chunks(doc_id, chunks)
        qs.upsert_chunks(doc_id, chunks, vectors)
        progress.mark_done(doc_id, filename=path.name)
        logger.info("Indexed %s — %d chunks", path.name, len(chunks))
        return True
    except Exception as exc:
        logger.exception("Failed to index %s: %s", path.name, exc)
        progress.clear_progress(doc_id)
        return False
    finally:
        lock.release()


def _iter_supported_files(directory: Path):
    for path in directory.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if _is_junk_filename(path.name):
            continue
        yield path


def index_all(directory: Path | None = None) -> Tuple[int, int]:
    """
    Index all supported documents in *directory* (default: all watched dirs).

    Pre-filters using the mtime cache so the batch counter reflects only the
    files that actually need work. Extraction runs in a background thread so
    pymupdf / openpyxl I/O overlaps with embedding on the main thread.

    Returns (files_indexed, files_skipped).
    """
    directories = [Path(directory)] if directory is not None else get_watched_docs_dirs()
    mtime_cache = get_all_documents_mtimes()

    todo: List[Path] = []
    skipped = 0
    seen: set[str] = set()
    for directory in directories:
        directory = Path(directory)
        if not directory.is_dir():
            continue
        for path in _iter_supported_files(directory):
            # Resolve once so the doc_id we emit to progress matches the one
            # /api/documents derives from resolve()'d paths; otherwise the
            # frontend can't map per-file progress back to its rows.
            resolved = path.resolve()
            key = str(resolved)
            if key in seen:
                continue
            seen.add(key)
            if _needs_index(resolved, mtime_cache):
                todo.append(resolved)
            else:
                skipped += 1

    if not todo:
        return 0, skipped

    progress.start_batch(total=len(todo))
    q: "queue.Queue" = queue.Queue(maxsize=2)
    stop = threading.Event()
    extractor = threading.Thread(
        target=_extract_worker,
        args=(todo, q, stop),
        name="docsense-extractor",
        daemon=True,
    )
    extractor.start()

    indexed = 0
    try:
        while True:
            item = q.get()
            if item is None:
                break
            path, payload, stat = item
            if payload is _EXTRACT_FAILED:
                skipped += 1
                progress.advance_batch(filename=path.name)
                continue
            ok = _consume(path, payload, stat)
            if ok:
                indexed += 1
            else:
                skipped += 1
            progress.advance_batch(filename=path.name)
    finally:
        stop.set()
        progress.finish_batch()
        extractor.join(timeout=5.0)

    return indexed, skipped


def index_paths(paths: Iterable[Path]) -> Tuple[int, int]:
    """Index a specific list of paths (used by the watcher for renames etc.)."""
    indexed = skipped = 0
    for p in paths:
        ok, _ = index_file(p)
        if ok:
            indexed += 1
        else:
            skipped += 1
    return indexed, skipped
