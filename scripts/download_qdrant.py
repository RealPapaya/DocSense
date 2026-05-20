"""
Pre-build helper: download the Qdrant binary for the current platform into
vendor/qdrant/<binary>.  Run this once before `pyinstaller DocSense.spec`.

Usage:
    python scripts/download_qdrant.py
"""
from __future__ import annotations
import json
import platform
import sys
import zipfile
import tarfile
import urllib.request
from pathlib import Path

GITHUB_API  = "https://api.github.com/repos/qdrant/qdrant/releases/latest"
VENDOR_DIR  = Path(__file__).parent.parent / "vendor" / "qdrant"

_sys     = platform.system()
_machine = platform.machine()

if _sys == "Windows":
    BIN_NAME = "qdrant.exe"
    SUFFIX   = "x86_64-pc-windows-msvc.zip"
elif _sys == "Darwin":
    BIN_NAME = "qdrant"
    SUFFIX   = "aarch64-apple-darwin.tar.gz" if _machine == "arm64" else "x86_64-apple-darwin.tar.gz"
else:
    BIN_NAME = "qdrant"
    SUFFIX   = "x86_64-unknown-linux-musl.tar.gz"


def _fetch_download_url() -> tuple[str, str]:
    print("Fetching latest Qdrant release info …")
    req = urllib.request.Request(GITHUB_API, headers={"User-Agent": "docsense-build"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    tag = data["tag_name"]
    for asset in data.get("assets", []):
        if asset["name"].endswith(SUFFIX):
            return tag, asset["browser_download_url"]
    raise RuntimeError(f"No asset found for suffix {SUFFIX!r} in release {tag}")


def _download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=300) as resp:
        total      = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with open(dest, "wb") as fh:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
                downloaded += len(chunk)
                if total:
                    print(f"\r  {downloaded * 100 // total:3d}%  {downloaded/1_048_576:.1f} MB",
                          end="", flush=True)
    print()


def main() -> None:
    dest = VENDOR_DIR / BIN_NAME
    if dest.exists():
        print(f"Already present: {dest}")
        return

    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    tag, url = _fetch_download_url()
    print(f"Downloading Qdrant {tag} ({SUFFIX}) …")

    archive = VENDOR_DIR / url.split("/")[-1]
    _download(url, archive)

    print("Extracting …")
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            for member in zf.namelist():
                if member.endswith(BIN_NAME):
                    zf.extract(member, VENDOR_DIR)
                    extracted = VENDOR_DIR / member
                    extracted.rename(dest)
                    break
    else:
        with tarfile.open(archive) as tf:
            for member in tf.getmembers():
                if member.name.endswith(BIN_NAME):
                    member.name = BIN_NAME
                    tf.extract(member, VENDOR_DIR)
                    break

    archive.unlink(missing_ok=True)

    if _sys != "Windows":
        dest.chmod(0o755)

    print(f"Done: {dest}")


if __name__ == "__main__":
    main()
