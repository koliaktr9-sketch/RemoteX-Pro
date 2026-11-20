@echo off
title RemoteX Pro Launcher
echo ========================================================
echo               Starting RemoteX Pro Suite
echo ========================================================
echo.

cd /d "%~dp0remotex-pro\apps\server"
start "RemoteX API Server" cmd /k "npm start"

timeout /t 2 /nobreak >nul

cd /d "%~dp0remotex-pro\apps\web"
start "RemoteX Web Dashboard" cmd /k "npm start"

timeout /t 3 /nobreak >nul

echo Opening browser at http://localhost:3000 ...
start http://localhost:3000

echo.
echo RemoteX Pro is now running!
echo - Web Dashboard: http://localhost:3000
echo - API & Signaling: http://localhost:4000
echo.
