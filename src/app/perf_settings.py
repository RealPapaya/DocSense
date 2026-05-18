"""
Persistent indexing performance mode.

Three discrete modes, mapped to concrete embedder thread / batch parameters.
Stored alongside watch settings in USER_SETTINGS_PATH so a Power Saver
choice survives restarts.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any

from app.config import USER_SETTINGS_PATH

VALID_MODES = ("power_saver", "balanced", "max_speed")
DEFAULT_MODE = "balanced"

_lock = threading.Lock()


def _read_raw_settings() -> dict[str, Any]:
    if not USER_SETTINGS_PATH.is_file():
        return {}
    try:
        with USER_SETTINGS_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_raw_settings(settings: dict[str, Any]) -> None:
    USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = USER_SETTINGS_PATH.with_suffix(USER_SETTINGS_PATH.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp_path.replace(USER_SETTINGS_PATH)


def get_perf_mode() -> str:
    settings = _read_raw_settings()
    mode = settings.get("perf_mode")
    if isinstance(mode, str) and mode in VALID_MODES:
        return mode
    return DEFAULT_MODE


def set_perf_mode(mode: str) -> str:
    if mode not in VALID_MODES:
        raise ValueError(f"invalid perf mode: {mode!r}")
    with _lock:
        settings = _read_raw_settings()
        settings["perf_mode"] = mode
        _write_raw_settings(settings)
    return mode


def _cpu_half() -> int:
    return max(1, (os.cpu_count() or 4) // 2)


def get_params(mode: str | None = None) -> dict[str, int]:
    """Return the concrete tuning parameters for *mode* (or the saved one)."""
    if mode is None:
        mode = get_perf_mode()
    half = _cpu_half()
    if mode == "power_saver":
        return {"threads": 1, "batch": 32}
    if mode == "max_speed":
        return {"threads": min(4, max(2, half)), "batch": 128}
    # balanced (default)
    return {"threads": min(2, half), "batch": 64}
