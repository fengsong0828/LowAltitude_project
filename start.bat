@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   低空飞行器管理平台 v3.0
echo   启动中...
echo ============================================
echo.
echo   静态服务: http://localhost:8080
echo   仿真引擎: http://localhost:8765
echo   按 Ctrl+C 停止
echo.

:: 启动仿真引擎（后台）
start "低空仿真引擎" cmd /c "python scripts\engine_server.py"

:: 等引擎就绪
timeout /t 2 /nobreak >nul

:: 启动静态服务 + 打开浏览器
start http://localhost:8080
python scripts\serve.py

pause
