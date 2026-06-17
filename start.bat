@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 确保数据目录存在
if not exist "data\nfz" mkdir "data\nfz"
if not exist "data\flightplans" mkdir "data\flightplans"

echo ============================================
echo   低空飞行器管理平台 v3.0
echo ============================================
echo.
echo   服务地址: http://localhost:8080
echo   仿真引擎: http://localhost:8765 (可选)
echo   按 Ctrl+C 停止
echo.

start http://localhost:8080
python scripts\serve.py
pause
