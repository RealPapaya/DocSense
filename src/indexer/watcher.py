"""
Watchdog-based folder monitor.

Watches WATCHED_DOCS_DIR for new / modified / moved / deleted files
and feeds them through the indexing pipeline automatically.

Bursty editors (Word, Excel, Acrobat) emit several ModifiedEvents per save,
so events are debounced and processed by a single worker thread. This means
the watchdog callback returns instantly and the actual extraction never
serialises on the OS event dispatch thread.

Start via:
    from indexer.watcher import start_watcher
    observer = start_watcher()   # returns a running Observer
    ...
    observer.stop(); observer.join()
"""
from __future__ import annotations
import logging
import queue
import threading
import time
import hashlib
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import (
    FileSystemEventHandler,
    FileCreatedEvent,
    FileModifiedEvent,
    FileMovedEvent,
    FileDeletedEvent,
)

from app.watch_settings import get_watched_docs_dirs
from indexer.extractor import SUPPORTED_EXTENSIONS
from indexer.pipeline import index_file
from app.services.fts import delete_document
from app.services.qdrant_store import delete_doc

logger = logging.getLogger(__name__)

# Debounce window: events for the same path arriving within this many seconds
# are coalesced into a single re-index. Tuned for typical editor save flurries.
_DEBOUNCE_SECONDS = 1.0

# Lower bound for declaring a write "complete": file size must stay stable
# across two consecutive polls separated by this interval.
_READY_POLL_INTERVAL = 0.2
_READY_TIMEOUT = 10.0


def _doc_id_from_path(filepath: str) -> str:
    return hashlib.sha256(filepath.encode()).hexdigest()[:16]


def _is_in_current_watch_dir(path: Path) -> bool:
    resolved = path.resolve()
    for directory in get_watched_docs_dirs():
        try:
            resolved.relative_to(directory)
            return True
        except ValueError:
            continue
    return False


# ── Background worker ─────────────────────────────────────────────────────────

class _IndexWorker:
    """Single-threaded queue consumer with per-path debounce.

    Multiple events for the same file collapse to one index_file call;
    the worker runs all extraction off the watchdog dispatch thread.
    """

    def __init__(self) -> None:
        self._q: queue.Queue[str | None] = queue.Queue()
        self._pending: dict[str, float] = {}   # path → scheduled-at time
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="indexer")
        self._thread.start()

    def submit(self, path: str) -> None:
        """Schedule (or re-schedule) *path* for indexing after the debounce window."""
        now = time.monotonic()
        with self._lock:
            self._pending[path] = now + _DEBOUNCE_SECONDS
        self._q.put(path)

    def shutdown(self) -> None:
        self._stop.set()
        self._q.put(None)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                path = self._q.get(timeout=0.5)
            except queue.Empty:
                continue
            if path is None:
                return

            # Drain debounce — only act when the latest scheduled time has passed.
            # `claimed` distinguishes "this dequeue won the race and should index"
            # from "the path was already handled by an earlier dequeue".
            claimed = False
            while not self._stop.is_set():
                with self._lock:
                    deadline = self._pending.get(path)
                if deadline is None:
                    break   # superseded by an earlier worker iteration
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    with self._lock:
                        if self._pending.get(path) == deadline:
                            self._pending.pop(path, None)
                            claimed = True
                    break
                time.sleep(min(remaining, 0.25))

            if self._stop.is_set() or not claimed:
                continue

            try:
                p = Path(path)
                if not p.exists():
                    continue
                if not _is_in_current_watch_dir(p):
                    logger.debug("Skipping event outside current watched folder: %s", path)
                    continue
                if not _wait_for_file_ready(path):
                    logger.warning("File not ready, skipping: %s", path)
                    continue
                index_file(p)
            except Exception:
                logger.exception("Indexing failed for %s", path)


_worker: _IndexWorker | None = None


def _wait_for_file_ready(path: str, timeout: float = _READY_TIMEOUT) -> bool:
    """Wait until the file size stops changing across one poll interval."""
    deadline = time.time() + timeout
    prev_size = -1
    while time.time() < deadline:
        try:
            size = Path(path).stat().st_size
            if size == prev_size and size > 0:
                return True
            prev_size = size
        except OSError:
            pass
        time.sleep(_READY_POLL_INTERVAL)
    return prev_size > 0


# ── Watchdog handler ──────────────────────────────────────────────────────────

class _DocEventHandler(FileSystemEventHandler):
    """Handle FS events for supported document types."""

    def _is_supported(self, path: str) -> bool:
        return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS

    def _submit(self, path: str) -> None:
        if _worker is not None:
            _worker.submit(path)

    def on_created(self, event: FileCreatedEvent) -> None:
        if not event.is_directory and self._is_supported(event.src_path):
            logger.debug("created: %s", event.src_path)
            self._submit(event.src_path)

    def on_modified(self, event: FileModifiedEvent) -> None:
        if not event.is_directory and self._is_supported(event.src_path):
            logger.debug("modified: %s", event.src_path)
            self._submit(event.src_path)

    def on_moved(self, event: FileMovedEvent) -> None:
        if event.is_directory:
            return
        src, dst = event.src_path, event.dest_path

        if self._is_supported(src):
            doc_id = _doc_id_from_path(str(Path(src).resolve()))
            try:
                delete_document(doc_id)
                delete_doc(doc_id)
                logger.info("Removed moved-away file: %s", src)
            except Exception:
                logger.exception("Failed removing moved-away doc")

        if self._is_supported(dst):
            logger.info("Indexing moved-to file: %s", dst)
            self._submit(dst)

    def on_deleted(self, event: FileDeletedEvent) -> None:
        if not event.is_directory and self._is_supported(event.src_path):
            doc_id = _doc_id_from_path(str(Path(event.src_path).resolve()))
            try:
                delete_document(doc_id)
                delete_doc(doc_id)
                logger.info("Removed deleted file: %s", event.src_path)
            except Exception:
                logger.exception("Failed removing deleted doc")


def start_watcher(directory: Path | None = None) -> Observer:
    """Start the watchdog observer + the indexing worker thread."""
    global _worker
    watch_dir = Path(directory or get_watched_docs_dirs()[0])
    watch_dir.mkdir(parents=True, exist_ok=True)

    if _worker is None:
        _worker = _IndexWorker()

    handler  = _DocEventHandler()
    observer = Observer()
    observer.schedule(handler, str(watch_dir), recursive=True)
    observer.daemon = True
    observer.start()
    logger.info("Watching for changes in: %s", watch_dir)
    return observer


def stop_worker() -> None:
    """Stop the background indexing worker (idempotent)."""
    global _worker
    if _worker is not None:
        _worker.shutdown()
        _worker = None
