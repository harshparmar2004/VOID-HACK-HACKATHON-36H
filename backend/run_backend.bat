@echo off
title Abhedya-Chakra Forensics Backend API
cd /d "%~dp0"
echo ===================================================
echo Starting Operation Abhedya-Chakra Forensics Core...
echo Dataset: 2,000,000 Banking Records (DuckDB Columnar)
echo Port: http://127.0.0.1:8000
echo ===================================================
python main.py
pause
