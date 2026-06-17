@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   低空飞行器管理平台 v3.0
echo ============================================
echo.
echo   启动仿真引擎 (8765) [可选]...
start "Engine" /min cmd /c "python scripts\engine_server.py 2>nul"

echo   启动 Web 服务 (8080)...
echo   浏览器即将打开...
echo.
echo   按 Ctrl+C 停止
echo.

timeout /t 2 /nobreak >nul
start "" http://localhost:8080

python scripts\serve.py
pause
