@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   低空飞行器管理平台 v3.0
echo ============================================
echo.
echo   正在启动服务...

:: 仿真引擎（后台静默，失败不阻塞）
start /min "" python scripts\engine_server.py >nul 2>&1

:: 浏览器
start "" http://localhost:8080

:: Web 服务（前台，Ctrl+C 停止）
python scripts\serve.py
pause
