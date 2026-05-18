"""Runtime control for the active watchdog observer."""
from __future__ import annotations

import logging
import threading

from app.watch_settings import get_watched_docs_dirs
from indexer.watcher import start_watcher

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_observers = []


def _stop_observers() -> None:
    global _observers
    for observer in _observers:
        try:
            observer.stop()
            observer.join(timeout=3)
        except Exception:
            logger.exception("Error stopping watcher")
    _observers = []


def start_current_watcher():
    """Start watching the currently configured directories."""
    global _observers
    with _lock:
        if not _observers:
            _observers = [start_watcher(directory) for directory in get_watched_docs_dirs()]
        return _observers


def restart_current_watcher():
    """Restart watchdog after the watched directories change."""
    global _observers
    with _lock:
        _stop_observers()
        _observers = [start_watcher(directory) for directory in get_watched_docs_dirs()]
        return _observers


def stop_current_watcher() -> None:
    """Stop the active watchdog observers, if any."""
    with _lock:
        _stop_observers()
