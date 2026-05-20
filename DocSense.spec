# -*- mode: python ; coding: utf-8 -*-
import platform as _platform
_qdrant_bin = 'qdrant.exe' if _platform.system() == 'Windows' else 'qdrant'

a = Analysis(
    ['start.py'],
    pathex=['src'],
    # Qdrant binary bundled at build time (scripts/download_qdrant.py).
    # Destination '.' places it in _MEIPASS root, same level as app/ and frontend/.
    binaries=[
        (f'vendor/qdrant/{_qdrant_bin}', '.'),
    ],
    datas=[
        # source path → bundled name under _MEIPASS (kept flat so frozen-mode
        # `from app.config import …` and `_MEIPASS / "frontend"` keep working)
        ('src/frontend', 'frontend'),
        ('src/app',      'app'),
        ('src/indexer',  'indexer'),
        # fastembed model bundled at build time (scripts/download_model.py).
        # Destination 'models' → _MEIPASS/models/ — matches MODEL_CACHE_DIR in config.py.
        ('vendor/models', 'models'),
    ],
    hiddenimports=[
        'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
        'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto',
        'uvicorn.lifespan', 'uvicorn.lifespan.off', 'uvicorn.lifespan.on',
        'fastapi', 'pydantic', 'pydantic_core',
        'fastembed', 'fastembed.embedding',
        'qdrant_client',
        'pymupdf',
        'docx',
        'openpyxl',
        'pptx',
        'watchdog', 'watchdog.observers', 'watchdog.observers.polling', 'watchdog.events',
        'app.main', 'app.config', 'app.models',
        'app.routes.search', 'app.routes.index',
        'app.services.embedder', 'app.services.fts', 'app.services.qdrant_store',
        'indexer.extractor', 'indexer.pipeline', 'indexer.watcher',
        'multiprocessing', 'sqlite3', 'httpx',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'sentence_transformers', 'tensorflow', 'sklearn'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='DocSense',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='DocSense',
)
