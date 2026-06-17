@echo off
chcp 65001 >nul
echo ╔══════════════════════════════════════╗
echo ║   低空巡检系统 - 环境初始化         ║
echo ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0.."

echo [1/4] 安装 CesiumJS 3D引擎 ~50MB...
call npm install cesium --save
if %errorlevel% neq 0 (
    echo   [错误] CesiumJS 安装失败
    pause
    exit /b 1
)
echo   [OK] CesiumJS 安装完成
echo.

echo [2/4] 安装 Python 依赖...
pip install numpy quantized-mesh-encoder -q
if %errorlevel% neq 0 (
    echo   [警告] quantized-mesh-encoder 安装失败，地形瓦片服务不可用
    echo   [提示] 建筑3D显示不受影响，可稍后安装
)
echo   [OK] Python 依赖安装完成
echo.

echo [3/4] 下载 OSM 建筑数据...
python scripts\download_osm.py
if %errorlevel% neq 0 (
    echo   [警告] OSM 数据下载失败，请检查网络
    echo   [提示] 可手动指定区域: python scripts\download_osm.py 南纬 西经 北纬 东经
)
echo.

echo [4/4] 下载 SRTM 地形数据（可选）...
python scripts\download_srtm.py
if %errorlevel% neq 0 (
    echo   [跳过] SRTM 下载（可选），不影响3D建筑展示
)
echo.

echo ╔══════════════════════════════════════╗
echo ║   初始化完成！                      ║
echo ║   运行 start.bat 启动系统            ║
echo ╚══════════════════════════════════════╝
pause
