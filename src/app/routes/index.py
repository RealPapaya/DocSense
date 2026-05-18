"""
POST /api/index           — trigger (re-)indexing of watched_docs/
GET  /api/status          — return index statistics
GET  /api/file/{doc_id}   — serve the original document (inline or download)
"""
from __future__ import annotations
import logging
import hashlib
import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.models import IndexResponse, StatusResponse
from app.config import DB_PATH
from app.services.fts import get_stats, get_all_documents
from indexer.progress import get_all as get_all_progress
from app.services.qdrant_store import collection_point_count
from app.services.qdrant_store import delete_doc
from app.services.fts import delete_document
from app.watch_runtime import restart_current_watcher
from app.watch_settings import get_watched_docs_dir, save_watched_docs_dir
from indexer.extractor import SUPPORTED_EXTENSIONS
from indexer.pipeline import index_all

router = APIRouter()
logger = logging.getLogger(__name__)


class WatchFolderApplyRequest(BaseModel):
    path: str
    clear_existing: bool = False


def _doc_id(filepath: str) -> str:
    return hashlib.sha256(filepath.encode()).hexdigest()[:16]


def _is_within_directory(filepath: str, directory: Path) -> bool:
    try:
        Path(filepath).resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _delete_documents_outside(directory: Path) -> int:
    deleted = 0
    for doc in get_all_documents():
        if _is_within_directory(doc["filepath"], directory):
            continue
        doc_id = doc["doc_id"]
        delete_document(doc_id)
        try:
            delete_doc(doc_id)
        except Exception:
            logger.exception("Failed deleting vectors for removed watched-folder doc: %s", doc_id)
        deleted += 1
    return deleted


@router.post("/index", response_model=IndexResponse)
async def trigger_index(background_tasks: BackgroundTasks):
    """
    Kick off a background re-index of everything in the watched folder.
    Returns immediately; indexing runs asynchronously.
    """
    def _run():
        indexed, skipped = index_all()
        logger.info("Background index complete: %d indexed, %d skipped", indexed, skipped)

    background_tasks.add_task(_run)
    return IndexResponse(
        status="ok",
        files_indexed=0,
        files_skipped=0,
        message="Indexing started in background. Check /api/status for progress.",
    )


@router.get("/progress")
async def get_progress():
    """Return per-file indexing progress. Keys are doc_ids, values are 0–99."""
    return get_all_progress()


@router.get("/status", response_model=StatusResponse)
async def get_status():
    """Return current index statistics."""
    stats = get_stats()
    return StatusResponse(
        total_documents=stats["total_documents"],
        total_chunks=stats["total_chunks"],
        collection_points=collection_point_count(),
        watched_docs_dir=str(get_watched_docs_dir()),
    )


@router.get("/documents")
async def list_documents():
    """Return indexed documents plus supported files found on disk.

    Large files can take a while to parse/embed. Including disk-discovered
    files lets the UI show that a file was found before indexing finishes.
    """
    docs_by_path = {
        doc["filepath"]: {**doc, "index_status": "indexed"}
        for doc in get_all_documents()
    }

    watched_docs_dir = get_watched_docs_dir()
    watched_docs_dir.mkdir(parents=True, exist_ok=True)
    for path in watched_docs_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        resolved = str(path.resolve())
        try:
            stat = path.stat()
        except OSError:
            continue

        existing = docs_by_path.get(resolved)
        if existing:
            if abs((existing.get("modified_at") or 0) - stat.st_mtime) >= 1.0:
                existing["index_status"] = "pending"
            continue

        docs_by_path[resolved] = {
            "doc_id": _doc_id(resolved),
            "filepath": resolved,
            "filename": path.name,
            "file_size": stat.st_size,
            "modified_at": stat.st_mtime,
            "chunk_count": 0,
            "index_status": "pending",
        }

    docs = sorted(docs_by_path.values(), key=lambda doc: doc["filepath"])
    return {"documents": docs, "total": len(docs)}


@router.post("/watch-folder/pick")
async def pick_watch_folder():
    """Open a native folder picker and return the selected path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise HTTPException(status_code=500, detail="native folder picker is unavailable") from exc

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            initialdir=str(get_watched_docs_dir()),
            title="Choose watched folder",
        )
        root.destroy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="failed to open folder picker") from exc

    if not selected:
        return {"cancelled": True, "path": ""}
    return {"cancelled": False, "path": str(Path(selected).expanduser().resolve())}


@router.post("/watch-folder/apply")
async def apply_watch_folder(payload: WatchFolderApplyRequest, background_tasks: BackgroundTasks):
    """Persist the watched folder, restart watchdog, and scan the new folder."""
    path = Path(payload.path).expanduser()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="path must be an existing directory")

    watched_docs_dir = save_watched_docs_dir(path)
    restart_current_watcher()

    if payload.clear_existing:
        _delete_documents_outside(watched_docs_dir)

    def _run():
        indexed, skipped = index_all(watched_docs_dir)
        logger.info("Watch folder scan complete: %d indexed, %d skipped", indexed, skipped)

    background_tasks.add_task(_run)
    return {
        "status": "ok",
        "watched_docs_dir": str(watched_docs_dir),
        "cleared": bool(payload.clear_existing),
    }


# ── File serving ──────────────────────────────────────────────────────────────

_MIME = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


@router.get("/file/{doc_id}")
async def serve_file(doc_id: str, download: int = Query(0)):
    """Return the original document for a given doc_id.

    The frontend uses this to open files in-browser (PDF inline) or as a
    download. The PDF inline view supports `#page=N` navigation, which the
    frontend appends client-side.
    """
    con = sqlite3.connect(str(DB_PATH))
    try:
        row = con.execute(
            "SELECT filepath, filename FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
    finally:
        con.close()

    if not row:
        raise HTTPException(status_code=404, detail="doc_id not found")

    filepath, filename = row
    path = Path(filepath)
    if not path.is_file():
        raise HTTPException(status_code=410, detail="file no longer on disk")

    ext = path.suffix.lower()
    media_type = _MIME.get(ext, "application/octet-stream")
    disposition = "attachment" if download else "inline"

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=filename,
        content_disposition_type=disposition,
    )


@router.get("/chunks/{doc_id}")
async def get_chunks(doc_id: str):
    """Return all text chunks for a document, ordered by chunk_index."""
    con = sqlite3.connect(str(DB_PATH))
    try:
        rows = con.execute(
            "SELECT chunk_index, page, text FROM chunks WHERE doc_id = ? ORDER BY chunk_index",
            (doc_id,),
        ).fetchall()
    finally:
        con.close()
    return {
        "doc_id": doc_id,
        "chunks": [
            {"chunk_index": r[0], "page": r[1], "text": r[2]}
            for r in rows
        ],
    }


@router.post("/open/{doc_id}")
async def open_file_native(doc_id: str):
    """Open a non-PDF file with the OS default application via os.startfile()."""
    con = sqlite3.connect(str(DB_PATH))
    try:
        row = con.execute(
            "SELECT filepath FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
    finally:
        con.close()

    if not row:
        raise HTTPException(status_code=404, detail="doc_id not found")

    path = Path(row[0])
    if not path.is_file():
        raise HTTPException(status_code=410, detail="file no longer on disk")

    os.startfile(str(path))
    return JSONResponse({"status": "ok"})
