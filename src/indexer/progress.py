"""
Indexing progress state — per-file + batch-level.

Thread-safe. Reads via :func:`get_state` return a snapshot dict so callers
(FastAPI route, watcher) don't see partial mutations.

Per-file entries are kept around for ``DONE_LINGER_SEC`` after completion so
the UI sees a 100% frame before they disappear. Batch state stays available
for ``BATCH_LINGER_SEC`` after the batch finishes (``active=False``) so the
frontend can render the final "27/27 done" frame before tearing down.
"""
from __future__ import annotations
import threading
import time
from typing import Optional

# How long a finished per-file entry stays visible at 100%.
DONE_LINGER_SEC = 1.5
# How long the batch payload stays after finish_batch() before being reset.
BATCH_LINGER_SEC = 2.5

_lock = threading.Lock()
_files: dict[str, dict] = {}  # doc_id -> {pct, phase, filename}
_batch: dict = {
    "active": False,
    "total": 0,
    "completed": 0,
    "current_file": None,
    "current_phase": None,
    "started_at": None,
    "finished_at": None,
}


def set_progress(
    doc_id: str,
    pct: int,
    phase: str | None = None,
    filename: str | None = None,
) -> None:
    """Update per-file progress and the batch's ``current_*`` fields."""
    pct = max(0, min(100, int(pct)))
    with _lock:
        entry = _files.get(doc_id, {})
        entry["pct"] = pct
        if phase is not None:
            entry["phase"] = phase
        if filename is not None:
            entry["filename"] = filename
        _files[doc_id] = entry
        if _batch["active"]:
            if filename is not None:
                _batch["current_file"] = filename
            elif "filename" in entry:
                _batch["current_file"] = entry["filename"]
            if phase is not None:
                _batch["current_phase"] = phase


def mark_done(doc_id: str, filename: str | None = None) -> None:
    """Set the file to 100% and schedule its removal after a short linger."""
    with _lock:
        entry = _files.get(doc_id, {})
        entry["pct"] = 100
        entry["phase"] = "done"
        if filename is not None:
            entry["filename"] = filename
        _files[doc_id] = entry

    def _drop() -> None:
        with _lock:
            cur = _files.get(doc_id)
            if cur is not None and cur.get("pct") == 100:
                _files.pop(doc_id, None)

    threading.Timer(DONE_LINGER_SEC, _drop).start()


def clear_progress(doc_id: str) -> None:
    """Immediately remove an entry (used for failed/cancelled files)."""
    with _lock:
        _files.pop(doc_id, None)


def start_batch(total: int) -> None:
    """Reset and activate the batch state for a new indexing pass.

    Does **not** touch ``_files``: the watchdog may be re-indexing a single
    file concurrently with a manual /api/index batch, and wiping its
    in-flight progress would make the UI freeze just like before. Stale
    entries are cleaned up by ``clear_progress`` in the failure paths and
    by ``mark_done``'s timed removal.
    """
    with _lock:
        _batch.update(
            active=True,
            total=int(total),
            completed=0,
            current_file=None,
            current_phase=None,
            started_at=time.time(),
            finished_at=None,
        )


def advance_batch(filename: Optional[str] = None) -> None:
    """Mark one more file as completed in the current batch."""
    with _lock:
        if _batch["active"]:
            _batch["completed"] = min(_batch["total"], _batch["completed"] + 1)
            if filename is not None:
                _batch["current_file"] = filename


def finish_batch() -> None:
    """Mark the batch inactive; payload lingers for BATCH_LINGER_SEC."""
    with _lock:
        if not _batch["active"] and _batch["finished_at"] is not None:
            return
        _batch["active"] = False
        _batch["finished_at"] = time.time()
        _batch["current_phase"] = None

    def _reset() -> None:
        with _lock:
            if _batch["active"]:
                return  # a new batch already started
            _batch.update(
                total=0,
                completed=0,
                current_file=None,
                current_phase=None,
                started_at=None,
                finished_at=None,
            )

    threading.Timer(BATCH_LINGER_SEC, _reset).start()


def get_state() -> dict:
    """Snapshot for the /api/progress endpoint."""
    with _lock:
        return {
            "files": {k: dict(v) for k, v in _files.items()},
            "batch": dict(_batch),
        }


# ── Legacy alias used by older callers / tests ───────────────────────────────
def get_all() -> dict:
    """Backwards-compatible: only the per-file dict, flattened to {doc_id: pct}."""
    with _lock:
        return {k: v.get("pct", 0) for k, v in _files.items()}
