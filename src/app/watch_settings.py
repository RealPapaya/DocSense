"""Helpers for the user-selected watched document directories."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.config import USER_SETTINGS_PATH, WATCHED_DOCS_DIR

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


def _normalize_directory(directory: str | Path) -> Path:
    return Path(directory).expanduser().resolve()


def _dedupe_directories(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    deduped: list[Path] = []
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


def get_watched_docs_dirs() -> list[Path]:
    """Return active watched directories, falling back to watched_docs/."""
    settings = _read_raw_settings()
    watch = settings.get("watch") if isinstance(settings.get("watch"), dict) else {}

    directories = watch.get("directories")
    if isinstance(directories, list):
        paths = [
            _normalize_directory(directory)
            for directory in directories
            if isinstance(directory, str) and directory.strip()
        ]
        paths = _dedupe_directories(paths)
        if paths:
            return paths

    # Backward compatibility with older settings files.
    directory = watch.get("directory")
    if isinstance(directory, str) and directory.strip():
        return [_normalize_directory(directory)]

    return [WATCHED_DOCS_DIR.resolve()]


def get_watched_docs_dir() -> Path:
    """Return the primary watched directory for legacy callers."""
    return get_watched_docs_dirs()[0]


def save_watched_docs_dirs(directories: list[Path]) -> list[Path]:
    """Persist active watched directories and return their resolved paths.

    The default watched_docs/ directory is always kept as the first entry.
    """
    default = WATCHED_DOCS_DIR.resolve()
    others = [
        p for p in (_normalize_directory(d) for d in directories)
        if str(p) != str(default)
    ]
    resolved = _dedupe_directories([default, *others])

    with _lock:
        settings = _read_raw_settings()
        watch = settings.get("watch") if isinstance(settings.get("watch"), dict) else {}
        settings["watch"] = {
            **watch,
            "directory": str(resolved[0]),
            "directories": [str(path) for path in resolved],
        }
        USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = USER_SETTINGS_PATH.with_suffix(USER_SETTINGS_PATH.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
            f.write("\n")
        tmp_path.replace(USER_SETTINGS_PATH)
    return resolved


def save_watched_docs_dir(directory: Path) -> Path:
    """Persist one active watched directory and return its resolved path."""
    return save_watched_docs_dirs([directory])[0]
