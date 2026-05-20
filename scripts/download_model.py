"""
Pre-build helper: download the fastembed embedding model into vendor/models/
so PyInstaller can bundle it.  Run this once before `pyinstaller DocSense.spec`.

Usage:
    python scripts/download_model.py

The model files land in vendor/models/<provider>/<model-slug>/ — exactly the
directory tree that fastembed expects when given cache_dir="vendor/models".
"""
from __future__ import annotations
import sys
from pathlib import Path

# Make sure `from app.config import EMBED_MODEL` works when called from repo root
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from app.config import EMBED_MODEL

VENDOR_MODELS_DIR = REPO_ROOT / "vendor" / "models"


def main() -> None:
    VENDOR_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    from fastembed import TextEmbedding

    print(f"Downloading model '{EMBED_MODEL}' into {VENDOR_MODELS_DIR} …")
    print("(This may take a few minutes on first run — ~130 MB)")

    model = TextEmbedding(model_name=EMBED_MODEL, cache_dir=str(VENDOR_MODELS_DIR))
    # Trigger the actual ONNX download by running a throwaway embedding
    list(model.embed(["warmup"]))

    print("Done.")
    print(f"Model cached at: {VENDOR_MODELS_DIR}")


if __name__ == "__main__":
    main()
