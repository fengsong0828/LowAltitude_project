@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   低空巡检系统 - 3D城市可视化
echo   启动中...
echo ============================================
echo.
echo   本地服务器: http://localhost:8080
echo   按 Ctrl+C 停止
echo.

start http://localhost:8080

python scripts\serve.py

pause
