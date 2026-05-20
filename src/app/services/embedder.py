"""
Thin wrapper around fastembed.TextEmbedding.

fastembed uses ONNX Runtime — no PyTorch required.
The model (~130 MB) is downloaded once on first use and cached by fastembed.

Threads and batch size are driven by ``app.perf_settings`` so the user-visible
Performance mode (Power Saver / Balanced / Max Speed) controls indexing cost.
The model is created once with a thread count; flipping the mode at runtime
updates batch size immediately but ONNX threads only take effect on the next
process start (fastembed/onnxruntime sessions don't expose live re-tuning).
"""
from __future__ import annotations
import os
import threading
from typing import Callable, List, Optional

from app.config import EMBED_MODEL

_model = None
_model_lock = threading.Lock()
_model_threads: int | None = None  # threads the live model was built with


def _resolve_threads() -> int:
    """Pick thread count from env override → perf_settings → CPU heuristic."""
    env_override = os.environ.get("DOCSENSE_EMBED_THREADS")
    if env_override:
        try:
            return max(1, int(env_override))
        except ValueError:
            pass
    try:
        from app.perf_settings import get_params  # local import to avoid cycle
        return int(get_params()["threads"])
    except Exception:
        return max(1, min(4, (os.cpu_count() or 4) // 2))


def _resolve_batch() -> int:
    env_override = os.environ.get("DOCSENSE_EMBED_BATCH")
    if env_override:
        try:
            return max(1, int(env_override))
        except ValueError:
            pass
    try:
        from app.perf_settings import get_params
        return int(get_params()["batch"])
    except Exception:
        return 64


def _get_model():
    global _model, _model_threads
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from fastembed import TextEmbedding
        threads = _resolve_threads()
        _model = TextEmbedding(model_name=EMBED_MODEL, threads=threads)
        _model_threads = threads
    return _model


def embed(
    texts: List[str],
    on_batch: Optional[Callable[[int, int], None]] = None,
) -> List[List[float]]:
    """Embed *texts*; calls ``on_batch(done, total)`` after each ONNX batch.

    Batches are sized via :func:`_resolve_batch` so peak memory stays bounded.
    """
    if not texts:
        return []
    model = _get_model()
    batch_size = _resolve_batch()
    total = len(texts)
    out: List[List[float]] = []
    for i in range(0, total, batch_size):
        chunk = texts[i : i + batch_size]
        for v in model.embed(chunk):
            out.append(v.tolist())
        if on_batch is not None:
            try:
                on_batch(len(out), total)
            except Exception:
                pass
    return out


def embed_query(query: str) -> List[float]:
    """Embed a single query string."""
    return embed([query])[0]
