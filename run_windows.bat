@echo off
cd /d %~dp0
start "" http://127.0.0.1:8803/
python -m uvicorn app.main:app --port 8803
pause
