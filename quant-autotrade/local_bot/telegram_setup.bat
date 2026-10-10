@echo off
rem Telegram setup: stops the bot (two receivers on one token would conflict), pairs this PC with your Telegram account, restarts the bot.
cd /d "%~dp0"
if not exist ".env" echo .env file not found. Copy .env.example to .env first. & pause & exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
python telegram_setup.py %*
echo.
echo Restarting the bot...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart.ps1"
pause
