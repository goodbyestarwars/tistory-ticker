@echo off
cd /d "%~dp0"
if not exist ".env" echo .env file not found. Copy .env.example to .env and fill in KIWOOM_APPKEY and KIWOOM_SECRETKEY. & pause & exit /b 1
python main.py
pause
