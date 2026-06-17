# 低空飞行器管理平台 v3.0

基于 **CesiumJS** + **OpenStreetMap** 真实数据的 3D 低空飞行器管理平台。覆盖中国 8 大城市，支持多飞行器实时仿真、告警监控、摄像头追踪、禁飞区手绘、飞行计划管理。

---

## 功能特性

### 飞行器管理
- **每城 5 架飞行器** — 物流配送 / 巡检 / 测绘 / eVTOL / 应急救援，40 架总计
- **实时航线仿真** — 沿预设航线自动飞行，电池消耗 + 低电返航 + 紧急降落
- **冲突检测** — 两两距离 < 200m 触发 L1-L3 告警，自动高度分离
- **通信丢失模拟** — 悬停 8s → 自动返航 → 安全降落
- **点击追踪** — 点击飞行器镜头自动跟随，画面中央持续追踪
- **飞行计划** — 地图选点/坐标输入 → 冲突评估 → 自动生成新飞行器（上限 20 架）
- **速度调节** — 选中飞行器后滑块实时调节 1-80 m/s
- **仿真控制** — 一键暂停/继续全局仿真

### 禁飞区管理
- **手动绘制** — 在地图上点击绘制多边形禁飞区，右键取消
- **闯入检测** — 飞行器进入禁飞区触发 L3 告警 + 紧急状态
- **接近预警** — 进入 1.5 倍半径范围触发 L1 接近告警
- **持久化存储** — 禁飞区保存至本地文件，跨重启保留

### 告警系统
- **7 类告警** — 冲突 / 围栏 / 电量 / 通信 / 偏航 / 天气 / 系统
- **4 级严重度** — INFO / L1 / L2 / L3
- **条件驱动清除** — 触发条件解除后告警自动消失（非按时间过期）
- **实时面板** — 左下角滚动告警列表，告警计数标记

### 3D 可视化
- **245,478 栋真实建筑** — OSM 建筑轮廓按高度分层挤出着色
- **8 城市一键切换** — 北京 / 上海 / 广州 / 深圳 / 重庆 / 成都 / 西安 / 杭州
- **瓦片动态加载** — 视口驱动按需加载/卸载，最大 8 块并行
- **多图层控制** — 建筑 / 水体 / 道路 / 植被 / 地形 / 飞行器 / 禁飞区 / 空域网格
- **空域网格** — 8×8 矩形覆盖，有飞行器的格子橙色高亮
- **摄像头 PIP** — 点击飞行器弹出 3×3 瓦片卫星图，前进方向始终朝上

### 数据持久化
- **上次城市记忆** — 重启自动恢复到上次选择的城市
- **禁飞区保存** — 绘制后自动保存到 `data/nfz/{city}.json`
- **飞行计划保存** — 提交后自动保存到 `data/flightplans/{city}.json`

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 3D 引擎 | CesiumJS 1.142 |
| 图块底图 | 本地卫星图块 + ESRI 在线备用 |
| 地形高程 | SRTM GL1 30m（Python 实时生成 quantized-mesh） |
| 仿真引擎 | Python FastAPI + WebSocket（可选，端口 8765） |
| 前端仿真 | JS 独立仿真（后端离线时自动降级） |
| 后端服务 | Python http.server（端口 8080） |
| 数据格式 | GeoJSON（城市瓦片）、JSON（飞行器/禁飞区/飞行计划） |
| 前端 | 原生 HTML/CSS/JS，零框架 |

---

## 项目结构

```
低空巡检系统/
├── index.html                     # 主页面
├── start.bat                      # 一键启动
├── package.json                   # npm (cesium)
├── css/style.css                  # UI 样式
├── js/
│   ├── app.js                     # 核心逻辑：Cesium 初始化、城市切换、UI 事件
│   ├── TileManager.js             # 瓦片加载/卸载/缓存
│   ├── AircraftManager.js         # 飞行器实体管理 + 动力学仿真
│   ├── AlertSystem.js             # 告警生成、去重、条件清除
│   ├── CameraView.js              # 3×3 瓦片摄像头 PIP
│   └── EngineClient.js            # Python 后端 WebSocket 客户端
├── scripts/
│   ├── serve.py                   # 静态服务 + 地形 + 图块 + 持久化 API
│   ├── engine_server.py           # 仿真引擎（FastAPI + WebSocket）
│   ├── split_to_tiles.py          # GeoJSON → 瓦片切分
│   ├── tile_downloader.py         # 扩展城市数据下载
│   ├── download_imagery.py        # 图块下载
│   ├── gen_aircraft.py            # 飞行器配置生成
│   └── gen_fleet.py               # 统一飞行器配置生成
├── data/
│   ├── tiles/{city}/              # 城市瓦片（index.json + 4 层 GeoJSON）
│   ├── aircraft/{city}.json       # 飞行器配置（每城 5 架）
│   ├── imagery/{z}/{x}/{y}.png    # 本地卫星图块
│   ├── nfz/{city}.json            # 禁飞区持久化
│   ├── flightplans/{city}.json    # 飞行计划持久化
│   ├── srtm/                      # SRTM 高程数据
│   └── last_city.txt              # 上次选择城市
└── node_modules/cesium/           # CesiumJS
```

---

## 快速开始

### 环境要求
- Python 3.11+ / Node.js / 支持 WebGL 的浏览器

### 首次安装

```batch
npm install
pip install numpy quantized-mesh-encoder
python scripts\split_to_tiles.py
python scripts\download_imagery.py global 3 4
```

### 启动

```batch
start.bat
```

浏览器自动打开 `http://localhost:8080`，展示完整地球 → 自动加载上次城市（首次默认北京）。

### 可选：启动仿真引擎（端口 8765）

```batch
python scripts\engine_server.py
```

引擎在线时飞行器由 Python 后端驱动，离线时前端 JS 仿真自动接管。

---

## 使用指南

### 布局

```
┌──────────────────────────────────────────────┐
│  标题栏                    城市名   在线:5    │
├──────────┬───────────────────────┬───────────┤
│ 飞行器   │                       │ 图层控制   │
│ 列表     │    Cesium 3D 地球     │ 速度/按钮  │
│          │                       ├───────────┤
│          │    🟢🟠🔵🔴🟡      │ 摄像头     │
├──────────┤                       │ 256×256   │
│ 实时告警 │                       │            │
└──────────┴───────────────────────┴───────────┘
│  坐标 | 高度 | FPS | 建筑数                │
```

### 城市切换
点击顶部城市按钮 → 飞行动画降至城市 → 瓦片/飞行器自动加载。

### 飞行器操作
- **点击飞行器实体** → 镜头追踪跟随 + 详情面板 + 摄像头弹窗
- **点击列表项** → 同上
- **再次点击** → 取消追踪
- **点击空白处** → 取消追踪
- **速度滑块** → 选中飞行器后调节 1-80 m/s

### 禁飞区绘制
1. 点击「绘制禁飞区」（变绿表示进入绘制模式）
2. 左键在地图上点击添加顶点
3. 再次点击「完成绘制」→ 生成红色禁飞区多边形
4. 右键或「清除禁飞区」取消/删除

### 飞行计划
1. 点击「提交飞行计划」→ 弹窗
2. 点击「选点」→ 在地图上点击起终点
3. 「提交评估」→ 冲突检查后自动生成新飞行器

### 图层控制
右侧面板勾选/取消各图层。勾选「3D 真实地形」需地形数据。

### 视角操作

| 操作 | 效果 |
|------|------|
| 左键拖拽 | 旋转 |
| 滚轮 | 缩放 |
| 右键拖拽 | 平移 |
| 「飞至数据区」 | 回到正北俯瞰 |

---

## 数据管理

### 城市数据量

| 城市 | 建筑 | 网格 | 瓦片大小 |
|------|------|------|----------|
| 北京 | 30,588 | 8×6 | 34 MB |
| 上海 | 40,789 | 5×5 | 49 MB |
| 广州 | 20,940 | 5×5 | 27 MB |
| 深圳 | 11,332 | 7×4 | 21 MB |
| 重庆 | 5,068 | 9×8 | 11 MB |
| 成都 | 36,794 | 6×5 | 36 MB |
| 西安 | 87,010 | 6×5 | 116 MB |
| 杭州 | 12,957 | 5×5 | 18 MB |

### 扩展数据

```batch
# 扩展城市 bbox 到完整都市圈（30-40km）
python scripts\tile_downloader.py beijing

# 下载更多图块
python scripts\download_imagery.py global 5 6
python scripts\download_imagery.py beijing 10 14
```

---

## 配置参数

| 参数 | 位置 | 值 | 说明 |
|------|------|-----|------|
| `MAX_LOADED_TILES` | TileManager.js | 8 | 最大同时瓦片数 |
| `MAX_AIRCRAFT` | AircraftManager.js | 20 | 飞行器数量上限 |
| `UNLOAD_DELAY_MS` | TileManager.js | 2000 | 瓦片卸载延迟 |
| `ZOOM` | CameraView.js | 16 | 摄像头瓦片级别 |
| 服务器端口 | serve.py / engine_server.py | 8080 / 8765 | |

---

## 添加新城市

1. `scripts/tile_downloader.py` 添加 bbox
2. `js/app.js` 添加城市坐标
3. `index.html` 添加按钮
4. `scripts/gen_aircraft.py` 生成飞行器配置
5. 运行下载脚本

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 地球无纹理 | `python scripts\download_imagery.py global 3 4` |
| 地形无效 | 安装 `numpy quantized-mesh-encoder` + 有 `.hgt` 文件 |
| 内存溢出 | 降低 `MAX_LOADED_TILES` |
| 仿真引擎连不上 | 引擎离线时自动降级前端仿真，正常现象 |
| 停止服务 | 关闭 cmd 窗口或 Ctrl+C |

---

## 许可

- 源代码：MIT
- 建筑/道路数据：© OpenStreetMap (ODbL)
- SRTM 地形：NASA/METI/AIST
- CesiumJS：Apache 2.0
- 卫星图：ESRI World Imagery
