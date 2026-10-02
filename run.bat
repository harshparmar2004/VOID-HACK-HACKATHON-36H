@echo off
rem Starts the API and the built UI on http://127.0.0.1:8000 and opens the browser.
rem Nothing is activated: the project's own Python is called by path.
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: .venv\Scripts\python.exe is missing. Create the virtual environment first.
    goto :fail
)
if not exist "data\case.duckdb" (
    echo ERROR: data\case.duckdb is missing. Build the case database first ^(engine\ingest.py and the engine steps^).
    goto :fail
)
if not exist "ui\dist\index.html" (
    echo ERROR: ui\dist is missing. Build the UI first: cd ui ^&^& npm run build
    goto :fail
)

rem Open the browser a few seconds after the server starts (ping = a delay).
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:8000"

echo Abhedya-Chakra on http://127.0.0.1:8000  (Ctrl+C stops it)
".venv\Scripts\python.exe" -m uvicorn api.main:app --host 127.0.0.1 --port 8000
exit /b %errorlevel%

:fail
pause
exit /b 1
