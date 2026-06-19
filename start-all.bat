@echo off
echo ====================================================================
echo   Starting Paperflow Studio Frontend ^& Python Preprocessing Backend
echo ====================================================================

:: 1. Start Vite dev server in a new window
echo Launching Vite frontend dev server (port 8080)...
start cmd /k "npm run dev"

:: 2. Setup and launch Python FastAPI service
echo Launching Python FastAPI service (port 8000)...
cd python-service

:: Check if Python is installed/available
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your system PATH.
    echo Please download and install Python from https://www.python.org/
    echo Once installed, make sure to check "Add Python to PATH" during installation.
    pause
    exit /b
)

:: Create virtual environment if it doesn't exist
if not exist .venv (
    echo Virtual environment not found. Creating .venv...
    python -m venv .venv
)

:: Activate venv and install dependencies
echo Activating virtual environment...
call .venv\Scripts\activate
echo Checking/Installing Python dependencies...
pip install -r requirements.txt

:: Start FastAPI backend
echo Starting FastAPI backend server...
set PAPERFLOW_PY_TOKEN=devtoken
uvicorn main:app --reload --port 8000
