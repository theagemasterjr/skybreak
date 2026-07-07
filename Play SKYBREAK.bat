@echo off
title SKYBREAK
cd /d "%~dp0"
echo Starting SKYBREAK...
start "SKYBREAK Server" /min cmd /c "node server.js & pause"
timeout /t 1 /nobreak >nul
start "" http://localhost:8123
exit
