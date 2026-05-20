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
from app.config import DB_PATH, WATCHED_DOCS_DIR
from app.services.fts import get_stats, get_all_documents
from indexer.progress import get_state as get_progress_state, clear_progress_for_doc_ids
from app.services.qdrant_store import collection_point_count
from app.services.qdrant_store import delete_doc
from app.services.fts import delete_document
from app.watch_runtime import restart_current_watcher
from app.watch_settings import (
    get_watched_docs_dir,
    get_watched_docs_dirs,
    save_watched_docs_dir,
    save_watched_docs_dirs,
)
from app.perf_settings import (
    VALID_MODES as PERF_MODES,
    get_params as get_perf_params,
    get_perf_mode,
    set_perf_mode,
)
from indexer.extractor import SUPPORTED_EXTENSIONS
from indexer.pipeline import index_all, purge_missing_docs, _is_junk_filename

router = APIRouter()
logger = logging.getLogger(__name__)


class WatchFolderApplyRequest(BaseModel):
    path: str
    clear_existing: bool = False


class WatchFoldersApplyRequest(BaseModel):
    paths: list[str]
    clear_existing: bool = False


def _doc_id(filepath: str) -> str:
    return hashlib.sha256(filepath.encode()).hexdigest()[:16]


def _is_within_directory(filepath: str, directory: Path) -> bool:
    try:
        Path(filepath).resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _is_within_any_directory(filepath: str, directories: list[Path]) -> bool:
    return any(_is_within_directory(filepath, directory) for directory in directories)


def _delete_documents_outside(directory: Path | list[Path]) -> int:
    directories = directory if isinstance(directory, list) else [directory]
    deleted = 0
    for doc in get_all_documents():
        if _is_within_any_directory(doc["filepath"], directories):
            continue
        doc_id = doc["doc_id"]
        delete_document(doc_id)
        try:
            delete_doc(doc_id)
        except Exception:
            logger.exception("Failed deleting vectors for removed watched-folder doc: %s", doc_id)
        deleted += 1
    return deleted


def _empty_progress_batch() -> dict:
    return {
        "active": False,
        "total": 0,
        "completed": 0,
        "current_file": None,
        "current_filepath": None,
        "current_phase": None,
        "started_at": None,
        "finished_at": None,
    }


def _filter_progress_for_watch_dirs(state: dict, directories: list[Path]) -> dict:
    """Hide stale in-flight progress for files outside the current watched roots."""
    files = state.get("files") or {}
    filtered_files = {
        doc_id: entry
        for doc_id, entry in files.items()
        if not entry.get("filepath") or _is_within_any_directory(entry["filepath"], directories)
    }
    batch = dict(state.get("batch") or {})
    current_filepath = batch.get("current_filepath")
    visible_inflight = any(entry.get("pct", 0) < 100 for entry in filtered_files.values())

    if batch.get("active"):
        current_is_outside = current_filepath and not _is_within_any_directory(
            current_filepath,
            directories,
        )
        if current_is_outside and visible_inflight:
            current = next(
                entry for entry in filtered_files.values() if entry.get("pct", 0) < 100
            )
            batch["current_file"] = current.get("filename")
            batch["current_filepath"] = current.get("filepath")
            batch["current_phase"] = current.get("phase")
        elif (current_is_outside and not visible_inflight) or (files and not filtered_files):
            batch = _empty_progress_batch()
    elif batch.get("finished_at") and not filtered_files:
        batch = _empty_progress_batch()

    return {"files": filtered_files, "batch": batch}


def _inflight_doc_ids_outside_paths(directories: list[Path]) -> set[str]:
    """Return active progress entries that no longer belong to watched roots."""
    state = get_progress_state()
    outside_ids: set[str] = set()
    unknown_ids: set[str] = set()

    for doc_id, entry in (state.get("files") or {}).items():
        if entry.get("pct", 0) >= 100:
            continue
        filepath = entry.get("filepath")
        if filepath:
            if not _is_within_any_directory(filepath, directories):
                outside_ids.add(doc_id)
        else:
            unknown_ids.add(doc_id)

    if not unknown_ids:
        return outside_ids

    con = sqlite3.connect(str(DB_PATH))
    try:
        rows = con.execute(
            "SELECT doc_id, filepath FROM documents WHERE doc_id IN ({})".format(
                ",".join("?" * len(unknown_ids))
            ),
            list(unknown_ids),
        ).fetchall()
    finally:
        con.close()

    outside_ids.update(
        doc_id
        for doc_id, filepath in rows
        if not _is_within_any_directory(filepath, directories)
    )
    return outside_ids


@router.post("/index", response_model=IndexResponse)
async def trigger_index(background_tasks: BackgroundTasks):
    """
    Kick off a background re-index of everything in the watched folder.
    Returns immediately; indexing runs asynchronously.
    """
    def _run():
        purged = purge_missing_docs()
        if purged:
            logger.info("Purged %d missing-file index entries", purged)
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
    """Return per-file + batch-level indexing progress."""
    return _filter_progress_for_watch_dirs(get_progress_state(), get_watched_docs_dirs())


class PerfModeRequest(BaseModel):
    mode: str


@router.get("/perf-mode")
async def get_perf_mode_route():
    mode = get_perf_mode()
    return {"mode": mode, "modes": list(PERF_MODES), "params": get_perf_params(mode)}


@router.post("/perf-mode")
async def set_perf_mode_route(payload: PerfModeRequest):
    try:
        mode = set_perf_mode(payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"mode": mode, "params": get_perf_params(mode)}


@router.get("/status", response_model=StatusResponse)
async def get_status():
    """Return current index statistics."""
    stats = get_stats()
    return StatusResponse(
        total_documents=stats["total_documents"],
        total_chunks=stats["total_chunks"],
        collection_points=collection_point_count(),
        watched_docs_dir=str(get_watched_docs_dir()),
        watched_docs_dirs=[str(path) for path in get_watched_docs_dirs()],
        default_watched_docs_dir=str(WATCHED_DOCS_DIR.resolve()),
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

    seen_paths: set[str] = set()
    for watched_docs_dir in get_watched_docs_dirs():
        watched_docs_dir.mkdir(parents=True, exist_ok=True)
        for path in watched_docs_dir.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            if _is_junk_filename(path.name):
                continue

            resolved = str(path.resolve())
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)
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


@router.get("/watch-folders")
async def list_watch_folders():
    return {"paths": [str(path) for path in get_watched_docs_dirs()]}


class WatchFolderPickRequest(BaseModel):
    start_dir: str = ""


@router.post("/watch-folder/pick")
async def pick_watch_folder(payload: WatchFolderPickRequest = WatchFolderPickRequest()):
    """Open a native folder picker and return the selected path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise HTTPException(status_code=500, detail="native folder picker is unavailable") from exc

    start = Path(payload.start_dir).expanduser() if payload.start_dir.strip() else None
    if start is None or not start.is_dir():
        start = get_watched_docs_dir()

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            initialdir=str(start),
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
    clear_progress_for_doc_ids(_inflight_doc_ids_outside_paths([watched_docs_dir]))

    if payload.clear_existing:
        _delete_documents_outside(watched_docs_dir)

    def _run():
        indexed, skipped = index_all(watched_docs_dir)
        logger.info("Watch folder scan complete: %d indexed, %d skipped", indexed, skipped)

    background_tasks.add_task(_run)
    return {
        "status": "ok",
        "watched_docs_dir": str(watched_docs_dir),
        "watched_docs_dirs": [str(path) for path in get_watched_docs_dirs()],
        "cleared": bool(payload.clear_existing),
    }


@router.post("/watch-folders")
async def apply_watch_folders(payload: WatchFoldersApplyRequest, background_tasks: BackgroundTasks):
    """Persist watched folders, restart watchdogs, and scan all configured folders."""
    paths = [Path(path).expanduser() for path in payload.paths if path and path.strip()]
    if not paths:
        raise HTTPException(status_code=400, detail="at least one path is required")
    for path in paths:
        if not path.is_dir():
            raise HTTPException(status_code=400, detail=f"path must be an existing directory: {path}")

    watched_docs_dirs = save_watched_docs_dirs(paths)
    restart_current_watcher()
    clear_progress_for_doc_ids(_inflight_doc_ids_outside_paths(watched_docs_dirs))

    if payload.clear_existing:
        _delete_documents_outside(watched_docs_dirs)

    def _run():
        indexed, skipped = index_all()
        logger.info("Watch folders scan complete: %d indexed, %d skipped", indexed, skipped)

    background_tasks.add_task(_run)
    return {
        "status": "ok",
        "watched_docs_dir": str(watched_docs_dirs[0]),
        "watched_docs_dirs": [str(path) for path in watched_docs_dirs],
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


def _open_docx_at_page(path: Path, page: int) -> bool:
    if page <= 0 or os.name != "nt":
        return False

    try:
        import base64
        import shutil
        import subprocess

        powershell = shutil.which("powershell") or shutil.which("powershell.exe")
        if not powershell:
            return False

        quoted_path = str(path).replace("'", "''")
        script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $true
$doc = $word.Documents.Open('{quoted_path}')
$doc.Activate()
$null = $word.Selection.GoTo(1, 1, {int(page)})
$word.Activate()
"""
        encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen(
            [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                encoded,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        return True
    except Exception:
        logger.exception("Failed to open DOCX at page %s: %s", page, path)
        return False


@router.post("/open/{doc_id}")
async def open_file_native(doc_id: str, page: int = Query(0)):
    """Open a non-PDF file with the OS default application.

    For .docx files on Windows, if *page* > 0, Word is automated through
    PowerShell COM so the document opens directly at the requested page.
    Falls back to ``os.startfile`` when that path is not available.
    """
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

    if path.suffix.lower() == ".docx" and _open_docx_at_page(path, page):
        return JSONResponse({"status": "ok", "page": page})

    os.startfile(str(path))
    return JSONResponse({"status": "ok"})
