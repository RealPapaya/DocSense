"""
Central configuration — all paths and tuneable constants live here.
Edit this file to change ports, model, chunk size, etc.
"""
import sys
import platform
from pathlib import Path

# ── Directories ───────────────────────────────────────────────────────────────
# When packaged as a PyInstaller exe, _MEIPASS points to the _internal bundle.
# User-facing data dirs (watched_docs, db, qdrant_*) must live next to the exe,
# not inside _internal, so users can find and manage them easily.
if getattr(sys, "frozen", False):
    # Packaged exe — place user data next to the .exe.
    # PyInstaller flattens src/frontend → _MEIPASS/frontend (see DocSense.spec
    # `datas`), so FRONTEND_DIR lives at the root of _MEIPASS in frozen mode.
    _EXE_DIR     = Path(sys.executable).parent
    BASE_DIR     = _EXE_DIR                            # user data next to DocSense.exe
    FRONTEND_DIR = Path(sys._MEIPASS) / "frontend"
else:
    # Dev layout: this file is at src/app/config.py, so three parents up = project root.
    BASE_DIR     = Path(__file__).parent.parent.parent
    FRONTEND_DIR = BASE_DIR / "src" / "frontend"

# All runtime/state directories live under data/ (gitignored). watched_docs/
# stays at the project root because it's the user-facing drop zone.
DATA_DIR         = BASE_DIR / "data"
QDRANT_BIN_DIR   = DATA_DIR / "qdrant_bin"
QDRANT_DATA_DIR  = DATA_DIR / "qdrant_data"
DB_DIR           = DATA_DIR / "db"
LOG_DIR          = DATA_DIR / "logs"
SNAPSHOTS_DIR    = DATA_DIR / "snapshots"
WATCHED_DOCS_DIR = BASE_DIR / "watched_docs"
USER_SETTINGS_PATH = DATA_DIR / "user-settings.local"

# ── Qdrant ────────────────────────────────────────────────────────────────────
QDRANT_HOST       = "localhost"
QDRANT_PORT       = 6333
QDRANT_COLLECTION = "documents"
QDRANT_VECTOR_SIZE = 384          # matches BAAI/bge-small-en-v1.5

# ── Embedding model ───────────────────────────────────────────────────────────
EMBED_MODEL = "BAAI/bge-small-en-v1.5"   # ~130 MB, ONNX, fast CPU inference

# ── Chunking ──────────────────────────────────────────────────────────────────
# 1500 chars ≈ 350-500 tokens — comfortably under bge-small's 512-token limit
# while giving each chunk enough semantic context. A 6 MB technical PDF chunks
# to ~2000 pieces (vs ~7000 with the old 512-char setting), so embedding is
# 3× faster and search ranks fewer candidates.
CHUNK_SIZE    = 1500
CHUNK_OVERLAP = 150   # 10% overlap so phrases on chunk boundaries still match

# ── SQLite ────────────────────────────────────────────────────────────────────
DB_PATH = DB_DIR / "docsense.db"

# ── API server ────────────────────────────────────────────────────────────────
API_HOST = "0.0.0.0"
API_PORT = 8000

# ── Search ────────────────────────────────────────────────────────────────────
RRF_K = 60   # Reciprocal Rank Fusion constant

# ── Qdrant binary (auto-downloaded by start.py) ───────────────────────────────
_sys     = platform.system()
_machine = platform.machine()

if _sys == "Windows":
    QDRANT_BIN_NAME    = "qdrant.exe"
    QDRANT_ASSET_SUFFIX = "x86_64-pc-windows-msvc.zip"
elif _sys == "Darwin":
    QDRANT_BIN_NAME    = "qdrant"
    QDRANT_ASSET_SUFFIX = (
        "aarch64-apple-darwin.tar.gz"
        if _machine == "arm64"
        else "x86_64-apple-darwin.tar.gz"
    )
else:   # Linux
    QDRANT_BIN_NAME    = "qdrant"
    QDRANT_ASSET_SUFFIX = "x86_64-unknown-linux-musl.tar.gz"

QDRANT_BIN_PATH = QDRANT_BIN_DIR / QDRANT_BIN_NAME
