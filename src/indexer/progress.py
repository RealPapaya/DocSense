"""
In-memory per-file indexing progress.

Keyed by doc_id; value is an int 0–99 (100 means done and is never stored —
the key is deleted instead).  Thread-safe for concurrent index_file() calls.
"""
from __future__ import annotations
import threading

_lock = threading.Lock()
_state: dict[str, int] = {}


def set_progress(doc_id: str, pct: int) -> None:
    with _lock:
        _state[doc_id] = pct


def clear_progress(doc_id: str) -> None:
    with _lock:
        _state.pop(doc_id, None)


def get_all() -> dict[str, int]:
    with _lock:
        return dict(_state)
