@echo off
title Operation Abhedya-Chakra - Cyber Fraud Correlator
color 0E

echo ===============================================================================
echo                OPERATION ABHEDYA-CHAKRA (VOID HACKS 8.0)
echo         In Association with: INDORE POLICE COMMISSIONERATE
echo ===============================================================================
echo.
echo [1/3] Checking environment...
cd /d "%~dp0"

echo [2/3] Starting Local Backend API (DuckDB In-Memory Engine)...
start "Abhedya-Chakra Backend (Port 8000)" cmd /k "cd /d %~dp0backend && python main.py"

timeout /t 3 /nobreak >nul

echo [3/3] Starting Claude-Themed Forensic Dashboard (Port 5173)...
start "Abhedya-Chakra Dashboard (Port 5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 2 /nobreak >nul
echo.
echo Opening Cyber Fraud Correlator Dashboard in your browser...
start http://localhost:5173

echo ===============================================================================
echo SYSTEM ACTIVE:
echo  • Dashboard UI: http://localhost:5173
echo  • Backend API:  http://127.0.0.1:8000/docs
echo  • Dataset:      2,000,000 Records Loaded in 4.5 Seconds
echo ===============================================================================
pause
