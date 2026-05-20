"""
start.py — single entry point for DocSense.

Run:
    python start.py

What this does
--------------
1. Download the Qdrant binary if missing (first run only, ~35 MB zip)
2. Launch Qdrant as a subprocess
3. Wait until Qdrant is healthy (polls /healthz)
4. Launch Uvicorn (FastAPI) in a background thread
5. Open http://localhost:8000 in the default browser
6. Block until Ctrl-C, then cleanly stop everything
"""
from __future__ import annotations
import os
import sys
import json
import time
import shutil
import signal
import zipfile
import tarfile
import logging
import platform
import threading
import subprocess
import webbrowser
import urllib.request
from pathlib import Path

# ── Bootstrap: make sure src/ is on sys.path so `import app`/`import indexer` work
PROJECT_ROOT = Path(__file__).parent.resolve()
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from app.config import (
    QDRANT_BIN_DIR,
    QDRANT_BIN_PATH,
    QDRANT_BIN_NAME,
    QDRANT_ASSET_SUFFIX,
    QDRANT_DATA_DIR,
    QDRANT_HOST,
    QDRANT_PORT,
    API_HOST,
    API_PORT,
    LOG_DIR,
    SNAPSHOTS_DIR,
)
from app.watch_settings import get_watched_docs_dir

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("start")

# ── GitHub release helpers ────────────────────────────────────────────────────
GITHUB_API = "https://api.github.com/repos/qdrant/qdrant/releases/latest"


def _latest_release_url() -> tuple[str, str]:
    """Return (version_tag, download_url) for the correct platform asset."""
    logger.info("Fetching latest Qdrant release info …")
    req = urllib.request.Request(GITHUB_API, headers={"User-Agent": "docsense"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    tag    = data["tag_name"]
    assets = data.get("assets", [])
    for asset in assets:
        if asset["name"].endswith(QDRANT_ASSET_SUFFIX):
            return tag, asset["browser_download_url"]

    raise RuntimeError(
        f"No matching Qdrant asset for suffix {QDRANT_ASSET_SUFFIX!r} in release {tag}"
    )


def _download_with_progress(url: str, dest: Path) -> None:
    logger.info("Downloading %s …", url)
    with urllib.request.urlopen(url, timeout=120) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size  = 1024 * 64
        with open(dest, "wb") as fh:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                fh.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    print(f"\r  {pct:3d}%  {downloaded/1_048_576:.1f} MB", end="", flush=True)
    print()


def ensure_qdrant_binary() -> None:
    """Download and unpack the Qdrant binary if it isn't already present."""
    if QDRANT_BIN_PATH.exists():
        logger.info("Qdrant binary found: %s", QDRANT_BIN_PATH)
        return

    QDRANT_BIN_DIR.mkdir(parents=True, exist_ok=True)
    tag, url = _latest_release_url()
    logger.info("Downloading Qdrant %s …", tag)

    archive = QDRANT_BIN_DIR / url.split("/")[-1]
    _download_with_progress(url, archive)

    logger.info("Extracting …")
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            # Extract only the binary
            for member in zf.namelist():
                if member.endswith(QDRANT_BIN_NAME):
                    zf.extract(member, QDRANT_BIN_DIR)
                    extracted = QDRANT_BIN_DIR / member
                    extracted.rename(QDRANT_BIN_PATH)
                    break
    else:
        with tarfile.open(archive) as tf:
            for member in tf.getmembers():
                if member.name.endswith(QDRANT_BIN_NAME):
                    member.name = QDRANT_BIN_NAME
                    tf.extract(member, QDRANT_BIN_DIR)
                    break

    archive.unlink(missing_ok=True)

    if platform.system() != "Windows":
        QDRANT_BIN_PATH.chmod(0o755)

    logger.info("Qdrant binary ready: %s", QDRANT_BIN_PATH)


# ── Qdrant process ────────────────────────────────────────────────────────────

def start_qdrant() -> subprocess.Popen:
    QDRANT_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Newer Qdrant versions prefer environment variables over CLI flags
    env = os.environ.copy()
    env["QDRANT__STORAGE__STORAGE_PATH"]   = str(QDRANT_DATA_DIR)
    # Qdrant defaults snapshots to ./snapshots relative to CWD; pin it under
    # data/ so nothing escapes the project's runtime-data subtree.
    env["QDRANT__STORAGE__SNAPSHOTS_PATH"] = str(SNAPSHOTS_DIR)
    env["QDRANT__SERVICE__HTTP_PORT"]      = str(QDRANT_PORT)
    env["QDRANT__SERVICE__HOST"]           = QDRANT_HOST
    # Qdrant defaults to verbose telemetry; disabling shaves ~100 ms off start.
    env.setdefault("QDRANT__TELEMETRY_DISABLED", "true")

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    qdrant_log = open(LOG_DIR / "qdrant.log", "ab")

    cmd = [str(QDRANT_BIN_PATH)]
    logger.info("Starting Qdrant: %s", " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        stdout=qdrant_log,
        stderr=qdrant_log,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if platform.system() == "Windows" else 0,
    )
    return proc


def wait_for_qdrant(timeout: int = 30) -> None:
    url = f"http://{QDRANT_HOST}:{QDRANT_PORT}/healthz"
    deadline = time.time() + timeout
    logger.info("Waiting for Qdrant to be ready …")
    # Fast initial probes; back off to 0.25 s once the first second has elapsed.
    poll = 0.05
    started = time.time()
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    logger.info("Qdrant ready in %.2fs", time.time() - started)
                    return
        except Exception:
            pass
        time.sleep(poll)
        if time.time() - started > 1.0:
            poll = 0.25
    raise RuntimeError(f"Qdrant did not become healthy within {timeout}s")


# ── Uvicorn thread ────────────────────────────────────────────────────────────

def start_uvicorn() -> threading.Thread:
    import uvicorn

    config = uvicorn.Config(
        "app.main:app",
        host=API_HOST,
        port=API_PORT,
        log_level="info",
        reload=False,
    )
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True, name="uvicorn")
    thread.start()
    return thread


def _wait_for_api(url: str, timeout: int = 15) -> None:
    """Block until the FastAPI port answers (lifespan finished + bound)."""
    deadline = time.time() + timeout
    started  = time.time()
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status < 500:
                    logger.info("API ready in %.2fs", time.time() - started)
                    return
        except Exception:
            pass
        time.sleep(0.1)
    logger.warning("API did not become ready within %ds — opening browser anyway", timeout)


# ── Main ──────────────────────────────────────────────────────────────────────

def _migrate_legacy_dirs() -> None:
    """Move pre-restructure runtime dirs (db/, qdrant_data/, qdrant_bin/,
    snapshots/, logs/) from project root into data/. One-shot — runs before
    Qdrant starts so we never race a locked qdrant_data/ folder."""
    legacy = ("db", "qdrant_data", "qdrant_bin", "snapshots", "logs")
    for name in legacy:
        old = PROJECT_ROOT / name
        new = PROJECT_ROOT / "data" / name
        if old.exists() and not new.exists():
            new.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old), str(new))
            logger.info("Migrated legacy dir: %s → %s", old, new)


def main() -> None:
    # 1. One-shot migration from the pre-data/ layout
    _migrate_legacy_dirs()

    # 2. Ensure required dirs exist
    get_watched_docs_dir().mkdir(parents=True, exist_ok=True)

    # 3. Download Qdrant binary if needed
    ensure_qdrant_binary()

    # 4. Launch Qdrant
    qdrant_proc = start_qdrant()
    try:
        wait_for_qdrant()
    except RuntimeError as exc:
        logger.error(str(exc))
        qdrant_proc.terminate()
        sys.exit(1)

    # 4. Start Uvicorn in background thread
    logger.info("Starting DocSense API on http://localhost:%d …", API_PORT)
    _uvicorn_thread = start_uvicorn()

    # Poll the API port until it accepts connections (typically <300 ms).
    api_url = f"http://localhost:{API_PORT}"
    _wait_for_api(api_url, timeout=15)

    # 5. Open browser unless the launcher is handling it.
    if os.environ.get("DOCSENSE_OPEN_BROWSER", "1").lower() not in {"0", "false", "no"}:
        logger.info("Opening browser at %s", api_url)
        webbrowser.open(api_url)
    else:
        logger.info("Browser launch is handled by the DocSense launcher.")

    # 6. Block until Ctrl-C
    logger.info("DocSense is running. Press Ctrl-C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass

    # 7. Shutdown
    logger.info("Shutting down …")
    qdrant_proc.terminate()
    try:
        qdrant_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        qdrant_proc.kill()
    logger.info("Goodbye.")


if __name__ == "__main__":
    main()
