# DocSense

> **English** | [中文說明](#docsense-中文說明)

**Local document hybrid search — PDF, DOCX, XLSX, PPTX.**  
Semantic + full-text hybrid search, fully offline, no Docker, no cloud, no GPU required.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Adding Documents](#adding-documents)
- [Search Modes](#search-modes)
- [User Interface](#user-interface)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Configuration](#configuration)
- [Development](#development)
- [Requirements](#requirements)
- [Building a Standalone Executable](#building-a-standalone-executable)

---

## Features

- 🔍 **Hybrid search** — fuses semantic (vector) and keyword (BM25) results via Reciprocal Rank Fusion (RRF)
- 📄 **Multi-format** — indexes PDF, DOCX, XLSX, and PPTX files out of the box
- ⚡ **Live indexing** — drop a file into `watched_docs/` and it is searchable within seconds, no restart required
- 🔒 **Fully offline** — no cloud APIs, no Docker, no internet connection after first-run setup
- 🧠 **ONNX embeddings** — uses `BAAI/bge-small-en-v1.5` via fastembed; no PyTorch, no GPU needed
- 🗄️ **Dual storage** — Qdrant binary (vector DB) + SQLite FTS5 (keyword DB) running side by side
- 🖥️ **Built-in UI** — React 18 SPA served at `http://localhost:8000`, no separate build step
- 📦 **Packagable** — PyInstaller spec included; ships as a single `.exe` for Windows

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd docsense

# 2. Create and activate a virtual environment (recommended)
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Launch DocSense
python start.py
```

**What happens on first run:**
1. Fetches the latest Qdrant binary from GitHub Releases (~35 MB, one-time download)
2. Starts Qdrant as a subprocess on port **6333**
3. Starts the FastAPI server on port **8000** via Uvicorn
4. Indexes any documents already present in `watched_docs/`
5. Pre-warms the ONNX embedding model in the background
6. Opens `http://localhost:8000` in your default browser

> The server is ready to accept requests immediately. Indexing and model warm-up happen in the background — poll `/api/status` or watch the progress bar in the UI.

---

## Adding Documents

Drop any **PDF, DOCX, XLSX, or PPTX** file into the `watched_docs/` folder.

- Files are detected and indexed automatically within a few seconds.
- No restart required.
- Updating an existing file triggers automatic re-indexing.
- Deleting a file purges it from the index on the next `/api/index` call.

You can also configure one or more watched folders directly from the UI settings panel.

---

## Search Modes

| Mode | How it works | Best for |
|------|-------------|----------|
| **Hybrid** (default) | Runs both vector and keyword search in parallel, fuses results with Reciprocal Rank Fusion (RRF, k=60), and normalises the final score so the top result = 1.0 | General use — best relevance |
| **Semantic / Vector** | Cosine similarity search via Qdrant using `BAAI/bge-small-en-v1.5` (384-dim) | Conceptual or natural-language queries |
| **Keyword** | SQLite FTS5 BM25 full-text search with trigram tokeniser | Exact term, part number, or code lookup |

Each result exposes three scores: `score` (final fused), `semantic_score` (cosine), and `bm25_score` (normalised BM25), which the UI uses to show score badges.

### Advanced Search Options

- **Occurrences view** — instead of grouping by document, shows every matching text span with a surrounding snippet
- **Whole word** — restricts matches to ASCII word boundaries
- **Match case** — case-sensitive matching
- **Related terms** — OR-expanded additional keywords fused alongside the main query
- **Path prefix filter** — restrict results to a specific sub-folder

---

## User Interface

The built-in SPA (React 18, served at `/`) provides:

| Panel | Description |
|-------|-------------|
| **Search bar** | Query input with mode selector and view toggle (Documents / Occurrences) |
| **Filters rail** | Path-prefix filter, related terms, whole-word/case toggles |
| **Results panel** | Document cards with score badges, match highlights, and chunk previews |
| **Preview panel** | In-browser PDF viewer (using the native browser PDF plugin) with `#page=N` navigation; other formats prompt a download |
| **Documents view** | Full list of indexed files with status indicators (indexed / pending) |
| **Bookmarks view** | Saved search results, persisted to `data/user-settings.local` |
| **Preferences panel** | Theme, layout, density, accent colour, font, card style — all persisted locally |
| **Progress bar** | Real-time per-file indexing progress streamed from `/api/progress` |

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/search?q=…&mode=hybrid&limit=10` | Search documents. Modes: `hybrid`, `vector`, `keyword`. Views: `documents`, `occurrences`. |
| `GET` | `/api/search?q=…&view=occurrences&offset=0` | Paginated occurrences view |
| `POST` | `/api/index` | Trigger a background re-index of all watched folders |
| `GET` | `/api/status` | Index statistics (document count, chunk count, Qdrant point count, watched folders) |
| `GET` | `/api/progress` | Real-time per-file and batch indexing progress |
| `GET` | `/api/documents` | List all indexed documents and any pending (not-yet-indexed) files |
| `GET` | `/api/file/{doc_id}` | Serve the original file inline (PDF opens in browser); add `?download=1` to force download |
| `GET` | `/api/chunks/{doc_id}` | Return all text chunks for a document |
| `POST` | `/api/open/{doc_id}` | Open a non-PDF file with the OS default application (`os.startfile`) |
| `GET` | `/api/watch-folders` | List currently watched folders |
| `POST` | `/api/watch-folder/pick` | Open a native OS folder picker and return the selected path |
| `POST` | `/api/watch-folder/apply` | Persist a single watched folder and re-index |
| `POST` | `/api/watch-folders` | Persist multiple watched folders and re-index |
| `GET` | `/api/perf-mode` | Get current indexing performance mode |
| `POST` | `/api/perf-mode` | Set indexing performance mode (`balanced`, `fast`, `low`) |
| `GET` | `/api/local-settings` | Read persisted UI settings (prefs, tags, bookmarks, watch config) |
| `POST` | `/api/local-settings` | Write persisted UI settings |
| `GET` | `/docs` | Swagger / OpenAPI interactive documentation |

---

## Project Structure

```
docsense/
├── start.py                    ← single entry point (downloads Qdrant, launches server)
├── docsense_launcher.py        ← Windows TUI launcher (alternative to start.py)
├── docsense.bat                ← Windows batch launcher
├── DocSense.spec               ← PyInstaller packaging spec
├── pyproject.toml              ← project metadata + dev dependencies
├── requirements.txt            ← runtime dependencies (ONNX-only, no PyTorch)
│
├── src/
│   ├── app/                    ← FastAPI application
│   │   ├── config.py           ← all paths, ports, model name, chunk settings
│   │   ├── main.py             ← app factory + lifespan handler
│   │   ├── models.py           ← Pydantic request/response schemas
│   │   ├── perf_settings.py    ← indexing thread/batch performance profiles
│   │   ├── watch_runtime.py    ← watcher lifecycle management
│   │   ├── watch_settings.py   ← watched-folder persistence
│   │   └── routes/
│   │       ├── search.py       ← GET /api/search  (hybrid RRF + annotations)
│   │       ├── index.py        ← /api/index, /api/status, /api/file, /api/documents …
│   │       └── settings.py     ← GET/POST /api/local-settings
│   │   └── services/
│   │       ├── embedder.py     ← fastembed ONNX singleton; lazy-loaded, thread-safe
│   │       ├── qdrant_store.py ← Qdrant HTTP client; UUID5 point IDs
│   │       └── fts.py          ← SQLite FTS5 + BM25; trigram tokeniser; schema v2
│   │
│   ├── indexer/
│   │   ├── extractor.py        ← PDF / DOCX / XLSX / PPTX → text chunks
│   │   ├── pipeline.py         ← extract → embed → atomic replace (SQLite + Qdrant)
│   │   ├── progress.py         ← per-file + batch progress tracking
│   │   └── watcher.py          ← watchdog observer; 1 s debounce; per-path locks
│   │
│   └── frontend/               ← React 18 SPA (no build step — Babel transpiles in-browser)
│       ├── index.html          ← shell; loads scripts in fixed dependency order
│       ├── styles/main.css     ← all CSS (~1 250 lines); theme/layout variables
│       ├── tooltip.js          ← lightweight [data-tip] tooltip
│       ├── lib/                ← shared utilities (helpers, i18n, prefs, tags, bookmarks, api)
│       ├── tweaks/             ← floating Preferences panel
│       ├── components/         ← Topbar, SearchRow, FiltersRail, ResultsPanel, PreviewPanel, StatusBar, TagAssignMenu
│       ├── views/              ← DocumentsView, BookmarksView
│       └── app.jsx             ← App root + ReactDOM.render (loads last)
│
├── data/                       ← all runtime state (gitignored)
│   ├── db/                     ← SQLite database (docsense.db)
│   ├── qdrant_data/            ← Qdrant vector storage
│   ├── qdrant_bin/             ← auto-downloaded Qdrant binary
│   ├── snapshots/              ← Qdrant snapshots
│   ├── logs/                   ← Uvicorn + Qdrant + launcher logs
│   └── user-settings.local     ← persisted UI prefs / tags / bookmarks
│
├── watched_docs/               ← drop your documents here (gitignored)
└── tests/
    ├── test_search_matching.py
    └── test_watch_folder.py
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  start.py  (single entry point)                             │
│    1. Migrate legacy dirs → data/   (one-shot)              │
│    2. Download Qdrant binary        (first run only)        │
│    3. Spawn Qdrant subprocess       (HTTP :6333)            │
│    4. Start Uvicorn/FastAPI         (background thread)     │
│    5. Open browser → http://localhost:8000                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  FastAPI lifespan (src/app/main.py)                          │
│    init_db() → ensure_collection() → start_watcher()        │
│    ↳ index_all() + _prewarm_embedder()  [background tasks]  │
└──────────┬──────────────────────┬───────────────────────────┘
           │                      │
           ▼                      ▼
    SQLite / FTS5            Qdrant (subprocess)
    (data/db/)               (data/qdrant_data/)

┌──────────────────────────────────────────────────────────────┐
│  Index pipeline  (src/indexer/pipeline.py)                   │
│    extract → chunk → embed → atomic replace                  │
│      │          │        └── fastembed ONNX (384-dim)        │
│      │          └─────────── 1 500 char / 150 overlap        │
│      └────────────────────── pymupdf / python-docx /         │
│                               openpyxl / python-pptx         │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Search pipeline  (src/app/routes/search.py)                 │
│    hybrid:  vector ‖ FTS5 → RRF (k=60) → normalise → top-N  │
│    vector:  Qdrant cosine top-K                              │
│    keyword: FTS5 BM25 (trigram tokeniser, LIKE fallback)     │
└──────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Concern | Choice | Why |
|---------|--------|-----|
| Embeddings | `BAAI/bge-small-en-v1.5` (ONNX, 384-dim) via fastembed | ~130 MB, CPU-only, MTEB top performer at this size |
| Vector DB | Qdrant binary subprocess (HTTP) | No Docker, no gRPC dependency; cosine + filter by `doc_id` |
| Full-text | SQLite FTS5 + trigram tokeniser + BM25 | Zero external deps; trigram supports CJK substrings |
| Fusion | Reciprocal Rank Fusion (k=60) | Score-scale agnostic; industry standard k=60 |
| Chunking | Fixed char 1 500 / 150 overlap | ≈350–500 tokens — safely under bge-small's 512-token limit |
| Doc ID | `sha256(abs_path)[:16]` | Stable across restarts; enables idempotent re-index |
| Atomic replace | DELETE old rows → INSERT new | Never leaves a half-indexed document in either store |
| Frontend | React 18 + Babel CDN (no build step) | Offline-first; no Node.js toolchain needed |

---

## Configuration

All tuneable constants live in `src/app/config.py`:

| Constant | Default | Description |
|----------|---------|-------------|
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | fastembed model name |
| `CHUNK_SIZE` | `1500` | Characters per chunk |
| `CHUNK_OVERLAP` | `150` | Overlap between adjacent chunks |
| `RRF_K` | `60` | RRF fusion constant |
| `QDRANT_PORT` | `6333` | Port for the Qdrant subprocess |
| `API_PORT` | `8000` | Port for the FastAPI server |
| `QDRANT_VECTOR_SIZE` | `384` | Must match the embedding model's output dimension |
| `WATCHED_DOCS_DIR` | `<project_root>/watched_docs` | Default document drop zone |
| `DATA_DIR` | `<project_root>/data` | Root for all runtime state |

---

## Development

```bash
# Install dev extras
pip install -e ".[dev]"

# Run tests
pytest

# Run a single test
pytest tests/test_search_matching.py::test_hybrid_search

# Lint
ruff check src/app src/indexer

# Format
ruff format src/app src/indexer
```

> `pyproject.toml` sets `pythonpath = ["src"]` so pytest can import `app.*` and `indexer.*` without any path hacks.

---

## Requirements

- **Python** 3.11+
- **Internet access on first run** — downloads the Qdrant binary (~35 MB) and the ONNX embedding model (~130 MB). Fully offline afterwards.
- **Disk space** — ~500 MB total (model cache + Qdrant binary + your document index)
- **No Docker.** No PyTorch. No GPU.

Supported platforms: Windows x86-64, macOS x86-64 / Apple Silicon (arm64), Linux x86-64.

---

## Building a Standalone Executable

A `DocSense.spec` PyInstaller spec is included for building a self-contained Windows `.exe`:

```bash
pip install pyinstaller
pyinstaller DocSense.spec
```

The resulting executable places all user-facing data directories (`watched_docs/`, `data/`) next to the `.exe` so users can find and manage them easily.

---

