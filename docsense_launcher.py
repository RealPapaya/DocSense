"""
docsense_launcher.py — Python-side TUI launcher for DocSense.

Why this exists
---------------
The original docsense.bat polled the API port every second via
`netstat | findstr` and spawned PowerShell for menus / banner / hidden
process control. On some Windows machines (corporate AV, slow CMD parsers,
PowerShell cold-start delays) each polling iteration took 1-3 s, making the
"Starting DocSense..." phase appear frozen for minutes.

This launcher replaces those `for /l` + PowerShell loops with stdlib Python:
ANSI-driven menu, in-process HTTP / socket polling, daemon-thread server
supervision. Zero pip dependencies — runs on the host Python before the
.venv is even created, then re-execs into the venv once available.

Compatible: Python 3.10+, Windows / macOS / Linux (TUI rendering targets
Windows Terminal / modern cmd; falls back to plain text when ANSI is off).
"""
from __future__ import annotations

import io
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Callable, List, Optional, Tuple

# ─── Force UTF-8 stdout on Windows so the banner renders correctly ───────────
if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
        os.system("chcp 65001 >nul 2>&1")
    except Exception:
        pass

# ─── Paths ────────────────────────────────────────────────────────────────────
ROOT_DIR  = Path(__file__).resolve().parent
# Runtime data is centralised under data/; keep path hard-coded here because
# launcher runs before .venv exists, so we cannot import app.config.
LOG_DIR   = ROOT_DIR / "data" / "logs"
LOG_FILE  = LOG_DIR / "docsense.log"
ERR_FILE  = LOG_DIR / "docsense.err.log"
START_PY  = ROOT_DIR / "start.py"
VENV_PY   = ROOT_DIR / ".venv" / "Scripts" / "python.exe"

API_HOST = "127.0.0.1"
API_PORT = 8000
API_URL  = f"http://localhost:{API_PORT}"

# ─── ANSI helpers ────────────────────────────────────────────────────────────
IS_WIN = sys.platform == "win32"


def _enable_win_ansi() -> bool:
    if not IS_WIN:
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        h = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        kernel32.GetConsoleMode(h, ctypes.byref(mode))
        kernel32.SetConsoleMode(h, mode.value | 0x0004)
        return True
    except Exception:
        return False


USE_COLOR = _enable_win_ansi()


def _c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def violet(t: str) -> str: return _c(t, "38;2;117;85;152")
def cyan(t: str) -> str:   return _c(t, "38;5;51")
def yellow(t: str) -> str: return _c(t, "38;5;226")
def green(t: str) -> str:  return _c(t, "38;5;84")
def red(t: str) -> str:    return _c(t, "38;5;203")
def dim(t: str) -> str:    return _c(t, "2")
def bold(t: str) -> str:   return _c(t, "1")


def _ansi(seq: str, fallback: str = "") -> str:
    """Return `seq` only if ANSI is enabled, else `fallback`. Lazy so that
    tests overriding USE_COLOR at runtime get the expected behaviour."""
    return seq if USE_COLOR else fallback


BANNER_LINES = [
    " ██████╗  ██████╗  ██████╗███████╗███████╗███╗   ██╗███████╗███████╗",
    " ██╔══██╗██╔═══██╗██╔════╝██╔════╝██╔════╝████╗  ██║██╔════╝██╔════╝",
    " ██║  ██║██║   ██║██║     ███████╗█████╗  ██╔██╗ ██║███████╗█████╗  ",
    " ██║  ██║██║   ██║██║     ╚════██║██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ",
    " ██████╔╝╚██████╔╝╚██████╗███████║███████╗██║ ╚████║███████║███████╗",
    " ╚═════╝  ╚═════╝  ╚═════╝╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝",
]


def print_banner() -> None:
    sys.stdout.write(_ansi("\033[3J\033[2J\033[H", "\n\n"))
    sys.stdout.write("\n")
    for line in BANNER_LINES:
        sys.stdout.write(violet(line) + "\n")
    sys.stdout.write(dim(f"   Universal Document Search  v1.0  |  {API_URL}") + "\n\n")
    sys.stdout.flush()


# ─── Keypress (cross-platform) ───────────────────────────────────────────────
if IS_WIN:
    import msvcrt

    def _getch() -> str:
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):
            arrow = msvcrt.getwch()
            return {"H": "UP", "P": "DOWN", "M": "RIGHT", "K": "LEFT"}.get(arrow, "OTHER")
        if ch == "\r":
            return "ENTER"
        if ch == "\x03":
            raise KeyboardInterrupt
        if ch == "\x1b":
            return "ESC"
        return ch
else:
    import termios
    import tty

    def _getch() -> str:
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            ch = sys.stdin.read(1)
            if ch == "\x1b":
                rest = sys.stdin.read(2)
                return {"[A": "UP", "[B": "DOWN", "[C": "RIGHT", "[D": "LEFT"}.get(rest, "ESC")
            if ch in ("\r", "\n"):
                return "ENTER"
            if ch == "\x03":
                raise KeyboardInterrupt
            return ch
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)


# ─── Server probes (no netstat, no PowerShell) ───────────────────────────────
def port_listening(port: int = API_PORT, host: str = API_HOST) -> bool:
    """
    True if anything is accepting TCP on (host, port).

    On Windows, an unfilled connect against 127.0.0.1 returns RST almost
    instantly, so a sub-100 ms timeout is plenty. We use create_connection
    rather than connect_ex so OS-level errors don't surface as exceptions
    inside hot polling loops.
    """
    try:
        with socket.create_connection((host, port), timeout=0.15):
            return True
    except (OSError, socket.timeout):
        return False


def api_responding(timeout: float = 1.0) -> bool:
    """
    True if the FastAPI app has finished lifespan and serves requests.

    Two-stage probe: cheap TCP connect first (skips the urlopen DNS / retry
    path entirely when nothing is listening), then a real HTTP request only
    if the port is open. This keeps the menu's idle-state check under 300 ms
    on machines where urlopen-on-refused-connection can otherwise take ~1 s.
    """
    if not port_listening():
        return False
    try:
        with urllib.request.urlopen(API_URL, timeout=timeout) as r:
            return r.status < 500
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False


# ─── Server lifecycle ────────────────────────────────────────────────────────
_server_proc: Optional[subprocess.Popen] = None


def _select_python() -> str:
    """Pick venv Python if present, otherwise the current interpreter."""
    if VENV_PY.exists():
        return str(VENV_PY)
    return sys.executable


def start_server() -> Tuple[bool, Optional[str]]:
    """
    Spawn start.py as a child. Suppresses the child's own browser-open call
    (we open the browser from this process once the port is hot).

    Returns (success, error_message).
    """
    global _server_proc
    if _server_proc and _server_proc.poll() is None:
        return True, None
    if api_responding():
        return True, None

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_fp = open(LOG_FILE, "a", encoding="utf-8", errors="replace")
    err_fp = open(ERR_FILE, "a", encoding="utf-8", errors="replace")

    env = os.environ.copy()
    env["DOCSENSE_OPEN_BROWSER"] = "0"
    env["PYTHONIOENCODING"] = "utf-8"

    creationflags = 0
    if IS_WIN:
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        _server_proc = subprocess.Popen(
            [_select_python(), str(START_PY)],
            cwd=str(ROOT_DIR),
            stdout=log_fp,
            stderr=err_fp,
            env=env,
            creationflags=creationflags,
            close_fds=True,
        )
    except OSError as e:
        return False, f"Failed to spawn start.py: {e}"
    return True, None


def stop_server() -> None:
    global _server_proc
    # Always try the port-kill path too — covers cases where a previous run
    # left an orphaned uvicorn/qdrant behind.
    _kill_listeners((API_PORT, 6333))
    if _server_proc and _server_proc.poll() is None:
        try:
            _server_proc.terminate()
            _server_proc.wait(timeout=5)
        except Exception:
            try:
                _server_proc.kill()
            except Exception:
                pass
    _server_proc = None


def _kill_listeners(ports: Tuple[int, ...]) -> None:
    """Best-effort: kill whatever owns the given TCP ports on this machine."""
    if not IS_WIN:
        for p in ports:
            try:
                out = subprocess.run(
                    ["lsof", "-ti", f"TCP:{p}"],
                    capture_output=True, text=True, timeout=3,
                )
                for pid in out.stdout.split():
                    subprocess.run(["kill", "-9", pid], capture_output=True, timeout=3)
            except Exception:
                pass
        return
    try:
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return
    import re
    wanted = {str(p) for p in ports}
    pids: set[str] = set()
    for line in out.stdout.splitlines():
        if "LISTENING" not in line:
            continue
        m = re.search(r":(\d+)\s+\S+\s+LISTENING\s+(\d+)", line)
        if m and m.group(1) in wanted:
            pids.add(m.group(2))
    for pid in pids:
        try:
            subprocess.run(["taskkill", "/F", "/PID", pid],
                           capture_output=True, timeout=3)
        except Exception:
            pass


# ─── Spinner / wait UI ───────────────────────────────────────────────────────
SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] \
    if not IS_WIN else ["|", "/", "-", "\\"]


def wait_for_api(timeout_s: int = 180) -> bool:
    """
    Poll the API port + lifespan readiness while drawing an animated spinner
    on the same line. Returns True if the API is responding within timeout.
    """
    start = time.monotonic()
    frame = 0

    def _draw(state_text: str) -> None:
        spin = SPIN_FRAMES[frame % len(SPIN_FRAMES)]
        line = f"  {violet(spin)} {state_text}"
        # Clear current line then reprint without newline.
        if USE_COLOR:
            sys.stdout.write("\r\033[2K" + line)
        else:
            sys.stdout.write("\r" + line.ljust(78))
        sys.stdout.flush()

    sys.stdout.write(_ansi("\033[?25l"))
    try:
        while True:
            elapsed = int(time.monotonic() - start)
            if elapsed > timeout_s:
                _draw(f"{red('API did not respond within')} {timeout_s}s — see {LOG_FILE.name}")
                sys.stdout.write("\n")
                return False

            # Stage 1: port not even open yet → Qdrant + uvicorn still booting
            if not port_listening():
                if elapsed < 8:
                    msg = "Starting DocSense services…"
                elif elapsed < 30:
                    msg = "Launching Qdrant + API…"
                else:
                    msg = f"Still starting (this can take a minute on first run) — {elapsed}s"
                _draw(f"{bold(msg)}  {dim(f'({elapsed}s)')}")
            else:
                # Stage 2: port open, waiting for FastAPI lifespan to finish
                if api_responding():
                    _draw(f"{green('Ready')}  {dim(API_URL)}")
                    sys.stdout.write("\n")
                    return True
                _draw(f"{bold('Finishing initialisation…')}  {dim(f'({elapsed}s)')}")

            frame += 1
            time.sleep(0.12)
    finally:
        sys.stdout.write(_ansi("\033[?25h"))
        sys.stdout.flush()


# ─── Menu ────────────────────────────────────────────────────────────────────
def server_state_badge() -> str:
    if api_responding(timeout=0.3):
        return f"  {green('●')} Server running  {dim(API_URL)}"
    if port_listening():
        return f"  {yellow('◌')} Server starting"
    return f"  {dim('○')} Server stopped"


def _item_line(label: str, selected: bool) -> str:
    if label.startswith("-"):
        return f"  {dim(label)}"
    if selected:
        return f"  {violet('>')} {bold(violet(label))}"
    return f"    {label}"


def _full_render(items: List[str], sel: int, hint: str) -> List[int]:
    """
    Print banner + badge + hint + all menu rows once. Returns the list of
    1-indexed terminal rows where each menu item landed, so subsequent
    keypresses can repaint just the two changed rows instead of redrawing
    the whole screen (which is what caused the brief black flash).
    """
    print_banner()
    # Banner uses 1 blank + 6 banner lines + " Universal..." + blank = 9 rows.
    # After print_banner the cursor is on row 10.
    sys.stdout.write(server_state_badge() + "\n")    # row 10
    sys.stdout.write("\n")                            # row 11
    sys.stdout.write(f"  {dim(hint)}\n")              # row 12
    sys.stdout.write("\n")                            # row 13
    first_item_row = 14
    item_rows: List[int] = []
    for i, label in enumerate(items):
        item_rows.append(first_item_row + i)
        sys.stdout.write(_item_line(label, i == sel) + "\n")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return item_rows


def _repaint_rows(item_rows: List[int], items: List[str],
                  changed: List[int], sel: int) -> None:
    """Overwrite exactly the rows in `changed`. Banner/badge stay untouched."""
    if not USE_COLOR:
        # Plain-text terminals don't support absolute cursor moves cheaply —
        # just reprint the menu region in-place using \r and overwrite.
        sys.stdout.write("\r")
        for i, label in enumerate(items):
            sys.stdout.write(_item_line(label, i == sel).ljust(78) + "\n")
        sys.stdout.flush()
        return
    parts: List[str] = []
    for i in changed:
        row = item_rows[i]
        parts.append(f"\033[{row};1H\033[2K")
        parts.append(_item_line(items[i], i == sel))
    # Park the cursor below the menu so user input doesn't appear on a row.
    parts.append(f"\033[{item_rows[-1] + 2};1H")
    sys.stdout.write("".join(parts))
    sys.stdout.flush()


def run_menu(items: List[str], hint: str = "Up/Down move   Enter select   Esc/q quit") -> Optional[int]:
    sel = 0
    while items[sel].startswith("-"):
        sel = (sel + 1) % len(items)

    sys.stdout.write(_ansi("\033[?25l"))
    try:
        item_rows = _full_render(items, sel, hint)
        while True:
            key = _getch()
            if key == "UP":
                prev = sel
                sel = (sel - 1) % len(items)
                while items[sel].startswith("-"):
                    sel = (sel - 1) % len(items)
                _repaint_rows(item_rows, items, [prev, sel], sel)
            elif key == "DOWN":
                prev = sel
                sel = (sel + 1) % len(items)
                while items[sel].startswith("-"):
                    sel = (sel + 1) % len(items)
                _repaint_rows(item_rows, items, [prev, sel], sel)
            elif key in ("1", "2", "3", "4", "0"):
                mapping = {"1": 0, "2": 1, "3": 2, "4": 3, "0": len(items) - 1}
                idx = mapping[key]
                if 0 <= idx < len(items) and not items[idx].startswith("-"):
                    return idx
            elif key == "ENTER":
                return sel
            elif key in ("ESC", "q", "Q"):
                return None
    finally:
        sys.stdout.write(_ansi("\033[?25h"))
        sys.stdout.flush()


# ─── Actions ─────────────────────────────────────────────────────────────────
def action_start() -> None:
    if api_responding(timeout=0.3):
        print(f"\n  {green('●')} Already running at {API_URL}\n")
        webbrowser.open(API_URL)
        _pause()
        return

    print(f"\n  {violet('◉')} Starting DocSense…\n")
    ok, err = start_server()
    if not ok:
        print(f"  {red('✗')} {err}\n  Log: {ERR_FILE}\n")
        _pause()
        return

    if wait_for_api(timeout_s=180):
        print(f"\n  {green('✓')} Opening {API_URL}\n")
        webbrowser.open(API_URL)
    else:
        print(f"\n  {yellow('!')} API did not respond yet — opening the browser anyway.")
        print(f"  The page will refresh automatically once the API is ready.")
        print(f"  Log: {LOG_FILE}\n")
        webbrowser.open(API_URL)
    _pause(timeout=1.5)


def action_restart() -> None:
    print(f"\n  {violet('◉')} Restarting DocSense…\n")
    stop_server()
    # Give Windows a moment to release the sockets.
    for _ in range(20):
        if not port_listening() and not port_listening(6333):
            break
        time.sleep(0.1)
    action_start()


def action_install() -> None:
    print(f"\n  {violet('◉')} Updating packages from requirements.txt…\n")
    py = _select_python()
    try:
        subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip"],
                       check=False)
        rc = subprocess.run([py, "-m", "pip", "install", "-r",
                             str(ROOT_DIR / "requirements.txt")]).returncode
        if rc == 0:
            print(f"\n  {green('✓')} Done.")
        else:
            print(f"\n  {red('✗')} pip install exited with code {rc}.")
    except Exception as e:
        print(f"\n  {red('✗')} {e}")
    _pause()


def action_open_docs() -> None:
    docs = ROOT_DIR / "watched_docs"
    docs.mkdir(parents=True, exist_ok=True)
    if IS_WIN:
        os.startfile(str(docs))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(docs)])
    else:
        subprocess.run(["xdg-open", str(docs)])


def action_exit() -> None:
    if api_responding(timeout=0.3) or port_listening():
        print(f"\n  {yellow('?')} Stop the running server? [Y/N] ", end="", flush=True)
        try:
            ans = input().strip().lower()
        except EOFError:
            ans = "y"
        if ans in ("", "y", "yes"):
            stop_server()
            print(f"  {green('●')} Server stopped.")
    print(f"\n  {violet('Goodbye.')}\n")
    sys.exit(0)


# ─── Utilities ───────────────────────────────────────────────────────────────
def _pause(timeout: Optional[float] = None) -> None:
    """Pause until the user presses a key, or for `timeout` seconds."""
    if timeout is not None:
        time.sleep(timeout)
        return
    print(f"  {dim('Press any key to return to menu…')}")
    try:
        _getch()
    except KeyboardInterrupt:
        pass


# ─── Main loop ───────────────────────────────────────────────────────────────
MENU_ITEMS: List[Tuple[str, Callable[[], None]]] = [
    ("[1]  Start server",           action_start),
    ("[2]  Restart server",         action_restart),
    ("[3]  Install / update packages", action_install),
    ("[4]  Open watched_docs folder",  action_open_docs),
    ("-" * 40,                       lambda: None),
    ("[0]  Exit",                    action_exit),
]


def main() -> None:
    labels = [label for label, _ in MENU_ITEMS]
    while True:
        idx = run_menu(labels)
        if idx is None:
            action_exit()
            return
        fn = MENU_ITEMS[idx][1]
        fn()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        action_exit()
