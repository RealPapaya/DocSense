"""
FastAPI application factory.

Startup sequence
----------------
1. Ensure DB schema exists (SQLite + FTS5)            — sync, fast
2. Ensure Qdrant collection exists                    — sync, fast
3. Start watchdog observer for live updates           — sync, fast
4. Kick off initial index pass on watched_docs/       — BACKGROUND task
5. Pre-warm the ONNX embedder                         — BACKGROUND task

Steps 4 and 5 run in a background thread so uvicorn starts accepting
requests immediately. Index progress can be polled via /api/status.

The frontend is served as static files from /frontend → mounted at /.
"""
from __future__ import annotations
import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import FRONTEND_DIR
from app.routes import search as search_router
from app.routes import index  as index_router
from app.routes import settings as settings_router
from app.services.fts import init_db
from app.services.qdrant_store import ensure_collection
from app.watch_runtime import start_current_watcher, stop_current_watcher
from app.watch_settings import get_watched_docs_dir
from app.perf_settings import get_perf_mode, get_params as get_perf_params
from indexer.pipeline import index_all
from indexer.watcher import stop_worker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_bg_tasks: set[asyncio.Task] = set()


def _run_initial_index() -> None:
    """Run the full index pass; logged so users can see progress in the log."""
    try:
        t0 = time.perf_counter()
        indexed, skipped = index_all()
        dt = time.perf_counter() - t0
        logger.info("Startup index: %d indexed, %d skipped in %.2fs", indexed, skipped, dt)
    except Exception:
        logger.exception("Startup index failed")


def _prewarm_embedder() -> None:
    """Load the ONNX model into memory so the first search isn't slow."""
    try:
        from app.services.embedder import _get_model
        t0 = time.perf_counter()
        _get_model()
        logger.info("Embedder pre-warmed in %.2fs", time.perf_counter() - t0)
    except Exception:
        logger.exception("Embedder pre-warm failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup (fast path only) ─────────────────────────────────────────────
    logger.info("Initialising database …")
    init_db()

    logger.info("Connecting to Qdrant …")
    ensure_collection()

    get_watched_docs_dir().mkdir(parents=True, exist_ok=True)

    perf_mode = get_perf_mode()
    perf_params = get_perf_params(perf_mode)
    logger.info(
        "Indexing performance mode: %s (threads=%d, batch=%d)",
        perf_mode, perf_params["threads"], perf_params["batch"],
    )

    logger.info("Starting file watcher …")
    start_current_watcher()

    # Schedule heavy work in background so server is ready immediately.
    loop = asyncio.get_running_loop()
    idx_task = loop.run_in_executor(None, _run_initial_index)
    warm_task = loop.run_in_executor(None, _prewarm_embedder)
    _bg_tasks.add(idx_task)
    _bg_tasks.add(warm_task)
    logger.info("Server ready. Initial index + embedder warm-up running in background.")

    yield   # app is running

    # ── Shutdown ─────────────────────────────────────────────────────────────
    stop_current_watcher()
    try:
        stop_worker()
    except Exception:
        logger.exception("Error stopping index worker")
    logger.info("Shutdown complete.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="DocSense",
        description="Local document search — PDF, DOCX, XLSX, PPTX",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routes - registered first to ensure they have priority
    app.include_router(search_router.router, prefix="/api")
    app.include_router(index_router.router,  prefix="/api")
    app.include_router(settings_router.router, prefix="/api")

    # Serve favicon.ico explicitly to avoid 404
    @app.get("/favicon.ico")
    async def serve_favicon():
        favicon_path = FRONTEND_DIR / "favicon.ico"
        if favicon_path.exists():
            return FileResponse(favicon_path)
        # Return a 204 No Content if favicon doesn't exist (better than 404)
        from fastapi.responses import Response
        return Response(status_code=204)

    # Serve the single-page frontend at / using SPAStaticFiles
    # This custom class ensures API routes are not overridden
    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except Exception:
                # If file not found, serve index.html for SPA routing
                # But DON'T do this for /api/ paths
                if not path.startswith("api/"):
                    return await super().get_response("index.html", scope)
                raise

    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

    return app


app = create_app()
