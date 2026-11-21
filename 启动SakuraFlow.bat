@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ======================================================
echo   SakuraFlow Studio v2.0 — 本地多智能体自由画布平台
echo ======================================================
start "" http://127.0.0.1:3888
node server.mjs
pause
