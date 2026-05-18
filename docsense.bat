@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: =============================================================================
:: DocSense Launcher  (thin bootstrap -- TUI lives in docsense_launcher.py)
::   1. Find a working Python 3.10+ interpreter
::   2. Create .venv + install requirements on first run
::   3. Hand control to docsense_launcher.py -- that is where the menu,
::      spinner, server lifecycle, and browser-open logic actually live.
::
:: Compatible: Windows 7 / 8.1 / 10 / 11  (32-bit and 64-bit)
::
:: Note: this file MUST stay pure ASCII. cmd.exe parses the script using the
:: console code page BEFORE chcp 65001 takes effect, so any multi-byte UTF-8
:: character outside a quoted string breaks parsing on cp950 / cp1252 hosts.
:: =============================================================================

set "DIR=%~dp0"
set "VENV_DIR=%DIR%.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "PROGRAMFILES_X86=%ProgramFiles(x86)%"
set "PY="
set "OLD_PY="
set "OLD_VER="

:: --- STEP 1: Locate a Python interpreter ------------------------------------
:: Existing .venv is the fast path for returning users
if exist "%VENV_PY%" (
    set "PY=%VENV_PY%"
    goto :CHECK_VERSION
)

:: py launcher ships with every official Python 3.3+ on Windows.
:: Ask for specific compatible versions so an older default (for example 3.6)
:: does not stop the search too early.
where py >nul 2>&1
if not errorlevel 1 (
    for %%v in (3.14 3.13 3.12 3.11 3.10) do (
        if not defined PY (
            for /f "delims=" %%i in ('py -%%v -c "import sys;print(sys.executable)" 2^>nul') do (
                set "PY=%%i"
            )
        )
    )
    if defined PY goto :CHECK_VERSION
)

:: Standard installation directories -- checks Python 3.10 .. 3.14
for %%v in (314 313 312 311 310) do (
    if exist "%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe" (
        set "PY=%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe"
        goto :CHECK_VERSION
    )
    if exist "%ProgramFiles%\Python%%v\python.exe" (
        set "PY=%ProgramFiles%\Python%%v\python.exe"
        goto :CHECK_VERSION
    )
    if defined PROGRAMFILES_X86 (
        if exist "!PROGRAMFILES_X86!\Python%%v\python.exe" (
            set "PY=!PROGRAMFILES_X86!\Python%%v\python.exe"
            goto :CHECK_VERSION
        )
    )
)

:: Plain `python` on PATH, skipping Windows Store stub aliases. Keep scanning
:: after old-but-working interpreters so a later compatible Python can win.
set "_FOUND=0"
for /f "delims=" %%i in ('where python 2^>nul') do (
    if "!_FOUND!"=="0" (
        echo "%%i" | findstr /i "WindowsApps" >nul
        if errorlevel 1 (
            "%%i" -c "import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
            if not errorlevel 1 (
                set "PY=%%i"
                set "_FOUND=1"
            ) else (
                if not defined OLD_PY (
                    for /f "delims=" %%v in ('"%%i" --version 2^>^&1') do set "OLD_VER=%%v"
                    set "OLD_PY=%%i"
                )
            )
        )
    )
)
if "!_FOUND!"=="1" goto :CHECK_VERSION

for /f "delims=" %%i in ('where python3 2^>nul') do (
    if "!_FOUND!"=="0" (
        "%%i" -c "import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
        if not errorlevel 1 (
            set "PY=%%i"
            set "_FOUND=1"
        ) else (
            if not defined OLD_PY (
                for /f "delims=" %%v in ('"%%i" --version 2^>^&1') do set "OLD_VER=%%v"
                set "OLD_PY=%%i"
            )
        )
    )
)
if "!_FOUND!"=="1" goto :CHECK_VERSION

goto :NO_PYTHON

:: --- STEP 2: Verify Python is 3.10 or newer ---------------------------------
:CHECK_VERSION
"%PY%" -c "import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
if errorlevel 1 (
    for /f "delims=" %%v in ('"%PY%" --version 2^>^&1') do set "_VER=%%v"
    echo.
    echo  [ERROR] Python 3.10 or newer is required.
    echo  Found  : !_VER!
    echo  Path   : %PY%
    echo.
    if /i "!PY!"=="%VENV_PY%" (
        echo  The existing .venv was created with an older Python.
        echo  Install Python 3.10 or newer, then delete only this app's .venv folder.
        echo  Do not uninstall your older system Python unless you want to.
        echo.
    )
    call :PYTHON_INSTALL_HELP
    exit /b 1
)

:: --- STEP 3: First-run setup (.venv + pip install) --------------------------
set "_NEED_SETUP=0"
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    set "_NEED_SETUP=1"
) else (
    "%VENV_PY%" -c "import fastapi" >nul 2>&1
    if errorlevel 1 set "_NEED_SETUP=1"
)

if "!_NEED_SETUP!"=="1" (
    call :FIRST_RUN_SETUP
    if errorlevel 1 (
        echo.
        echo  Setup failed -- check the messages above.
        pause
        exit /b 1
    )
)

:: Prefer the venv Python from here on
if exist "%VENV_PY%" set "PY=%VENV_PY%"

set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

:: --- STEP 4: Hand off to the Python TUI -------------------------------------
"%PY%" "%DIR%docsense_launcher.py"
exit /b %errorlevel%


:: =============================================================================
:: SUBROUTINE: First-run setup -- create .venv and install packages
:: =============================================================================
:FIRST_RUN_SETUP
echo.
echo    DocSense -- First-Run Setup
echo.
echo    Python : %PY%
echo.
echo    This will:
echo      1. Create a virtual environment in .venv\
echo      2. Install required packages  (~500 MB first time)
echo.
echo    An internet connection is required for step 2.
echo.
set "_OK=y"
set /p "_OK=    Proceed? [Y/n]: "
if /i "!_OK!"=="n" (
    echo    Cancelled.
    exit /b 1
)

echo.
echo    [1/2] Creating virtual environment...
"%PY%" -m venv "%VENV_DIR%"
if errorlevel 1 (
    echo.
    echo    [ERROR] Failed to create virtual environment.
    echo    Ensure the 'venv' module is included with your Python install.
    exit /b 1
)

echo    [2/2] Installing packages (this may take a few minutes)...
echo.
"%VENV_PY%" -m pip install --upgrade pip >nul 2>&1
"%VENV_PY%" -m pip install -r "%DIR%requirements.txt"
if errorlevel 1 (
    echo.
    echo    [ERROR] Package installation failed.
    echo    Check your internet connection, then re-run docsense.bat.
    exit /b 1
)

echo.
echo    Setup complete!
timeout /t 2 >nul
exit /b 0


:: =============================================================================
:: Python not found anywhere
:: =============================================================================
:NO_PYTHON
echo.
echo  +--------------------------------------------------+
echo  ^|  Python Not Found                                ^|
echo  +--------------------------------------------------+
echo.
echo   DocSense requires Python 3.10 or newer.
if defined OLD_PY (
    echo.
    echo   Found an older Python, but it cannot run DocSense:
    echo     !OLD_VER!
    echo     !OLD_PY!
)
echo.
call :PYTHON_INSTALL_HELP
exit /b 1


:: =============================================================================
:: SUBROUTINE: Friendly Python install guidance
:: =============================================================================
:PYTHON_INSTALL_HELP
echo   Install Python 3.10 or newer, then run this launcher again.
echo.
echo   You can keep older Python versions such as Python 3.6.8 installed.
echo   Installing a newer Python side-by-side is OK.
echo.
echo   During installation, make sure to check:
echo     [v] Add Python to PATH
echo     [v] Install for all users  ^(recommended^)
echo.
echo   Options:
echo     [D] Open the official Python download page
echo     [Enter] Close this window
echo.
set "_PY_HELP="
set /p "_PY_HELP=  Choose an option: "
if /i "!_PY_HELP!"=="D" (
    start "" "https://www.python.org/downloads/"
)
exit /b 0
