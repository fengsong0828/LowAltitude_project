# 低空巡检系统 — 3D 城市可视化平台 v4.0

基于 **CesiumJS** + **OpenStreetMap** 真实数据，完全本地化运行的 3D 城市低空巡检可视化系统。v4.0 核心升级：**瓦片化动态加载**，告别全量加载，地图漫游按需拼接。

---

## 功能特性

### 3D 城市可视化
- **245,478 栋真实建筑** — 从 OpenStreetMap 获取建筑轮廓与高度，按高度分层着色
- **8 座城市** — 北京、上海、广州、深圳、重庆、成都、西安、杭州
- **瓦片化动态加载** — 根据视口按需加载/卸载瓦片，不再一次性加载全城数据
- **北向正位视角** — 所有城市视图上北下南左西右东
- **建筑点击信息** — 点击任意建筑显示高度、楼层、类型等属性

### 多图层叠加（7层独立控制）
| 图层 | 数据来源 | 视觉效果 |
|------|----------|----------|
| 3D 建筑 | OSM 建筑多边形挤出 | 蓝→深蓝灰按高度渐变 |
| 水体/河流 | 湖泊、河道面状+线状 | 蓝色半透明 |
| 道路网络 | 6 级道路（高速→支路） | 橙→白→灰按等级着色 |
| 植被/公园 | 公园、森林、草地 | 绿色半透明 |
| 3D 真实地形 | SRTM 30m 高程 | 山脉、丘陵起伏 |
| 巡检路线 | 自动生成环形+网格航线 | 发光路径+航点标记 |
| 禁飞区域 | 半透明红色圆柱 | 无人机禁飞标记 |

### 巡检功能
- **预设巡逻航线** — 每个城市环形巡逻 + 网格扫描两条航线
- **无人机飞行模拟** — 扁平椭圆体飞行器沿航线实时移动（1-50 m/s 可调）
- **禁飞区管理** — 每城 3 个半透明红色圆柱
- **实时坐标追踪** — 鼠标移动显示经纬度

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 3D 引擎 | CesiumJS 1.142（本地 npm） |
| 建筑/道路/水体/植被 | OpenStreetMap Overpass API |
| 底图 | 本地卫星图块 + ESRI 在线备用 |
| 地形高程 | SRTM GL1 30m |
| 地形生成 | Python quantized-mesh-encoder 实时转换 |
| 本地服务 | Python http.server |
| 瓦片管理 | TileManager.js（视口驱动加载/卸载） |
| 前端 | 原生 HTML/CSS/JS，零框架 |

---

## 项目结构

```
低空巡检系统/
├── index.html                      # 主页面
├── start.bat                       # 一键启动
├── package.json                    # npm 依赖 (cesium)
│
├── css/style.css                   # UI 样式
│
├── js/
│   ├── app.js                      # 核心应用逻辑
│   └── TileManager.js              # 瓦片动态加载管理器
│
├── scripts/
│   ├── serve.py                    # 本地服务器（静态+地形+图块）
│   ├── tile_downloader.py          # 扩展城市数据（网格分批下载）
│   ├── split_to_tiles.py           # GeoJSON → 瓦片切分
│   ├── download_imagery.py         # 图块下载（全球+城市区域）
│   ├── download_cities.py          # 8城建筑数据（旧版全量）
│   ├── download_features.py        # 自然要素（旧版全量）
│   ├── download_srtm.py            # SRTM 地形下载
│   └── download_osm.py             # 单区域建筑下载
│
├── data/
│   ├── tiles/{city}/               # 瓦片化城市数据
│   │   ├── index.json              #   网格元信息
│   │   ├── buildings/              #   建筑瓦片
│   │   ├── water/                  #   水体瓦片
│   │   ├── roads/                  #   道路瓦片
│   │   └── vegetation/             #   植被瓦片
│   ├── imagery/{z}/{x}/{y}.png     # 本地卫星图块
│   ├── cities/                     # 原始 GeoJSON（旧版）
│   └── srtm/                       # SRTM 高程 .hgt
│
└── node_modules/cesium/            # CesiumJS 引擎
```

---

## 快速开始

### 环境要求
- **Python 3.11+**（pip 可用）
- **Node.js**（npm 可用）
- 浏览器支持 WebGL

### 首次安装

```batch
# 1. 安装 CesiumJS
npm install

# 2. 安装 Python 依赖
pip install numpy quantized-mesh-encoder

# 3. 切分现有数据为瓦片（即时完成）
python scripts\split_to_tiles.py

# 4. 下载全球低分辨率图块（区分大陆和海洋，约 4MB）
python scripts\download_imagery.py global 3 4

# 5. （可选）下载城市区域高分辨率图块
python scripts\download_imagery.py beijing 10 14
```

### 启动系统

```batch
start.bat
```

浏览器打开 `http://localhost:8080`，显示完整地球后缓缓转向中国方向。点击城市按钮进入对应城市。

---

## 使用指南

### 初始界面
打开页面 → 完整地球从太空展示（22,000 km）→ 3 秒后缓缓转向中国。**不自动加载任何城市**。

### 查看城市
点击顶部城市按钮 → 飞行动画降至城市上空 → 瓦片逐块加载建筑/道路/水体/植被。

### 图层控制
右侧面板「图层显示」区域可独立开关 7 个图层。勾选「3D 真实地形」需确保 Python 服务器运行且 `data/srtm/` 有数据。

### 巡逻模拟
1. 勾选「巡检路线」→ 选择航线类型
2. 调节飞行速度 → 点击「开始」
3. 无人机沿航线自动移动，可暂停/重置

### 视角操作
| 操作 | 效果 |
|------|------|
| 鼠标左键拖拽 | 旋转视角 |
| 鼠标滚轮 | 缩放 |
| 鼠标右键拖拽 | 平移 |
| 点击「飞至数据区」 | 回到城市正北俯瞰 |

---

## 瓦片化加载架构（v4.0）

### 核心原理

```
相机移动
  │
  ▼
camera.changed → TileManager.update()
  │
  ▼
computeViewRectangle() → 视口经纬度范围
  │
  ▼
计算相交瓦片 (col, row)
  │
  ├── 新瓦片: fetch GeoJSON → Cesium Entity → 加入场景
  │
  └── 离开瓦片: 2秒延迟 → 移除 Entity → 释放内存
```

### 关键参数
| 参数 | 值 | 说明 |
|------|-----|------|
| 瓦片大小 | 0.05° × 0.05° | 约 5.5 km × 5.5 km |
| 最大加载数 | 60 块 | 超出上限暂停新加载 |
| 并行下载 | 3 路 | 限流避免网络拥塞 |
| 卸载延迟 | 2 秒 | 避免来回拖动抖动 |
| 数据缓存 | 无 | JSON 用完即弃，GC 回收 |

### 本地图块系统
图块存储于 `data/imagery/{z}/{x}/{y}.png`，启动时本地优先 → 本地无则回退 ESRI 在线卫星图。

```
下载策略：
  zoom 3-4   全球全景（64+256=320块, ~3MB）  ← 显示大陆/海洋
  zoom 5-6   全球放大（1024+4096块, ~100MB） ← 中国轮廓清晰
  zoom 7-9   亚洲区域（可选）
  zoom 10-14 城市区域（按需逐城下载）
```

---

## 数据管理

### 城市瓦片数据量
| 城市 | 网格 | 建筑 | 水体 | 道路 | 植被 | 瓦片总大小 |
|------|------|------|------|------|------|-----------|
| 北京 | 8×6 | 30,588 | 231 | 7,684 | 1,198 | 34 MB |
| 上海 | 5×5 | 40,789 | 353 | 8,703 | 1,551 | 49 MB |
| 广州 | 5×5 | 20,940 | 401 | 7,287 | 764 | 27 MB |
| 深圳 | 7×4 | 11,332 | 268 | 3,847 | 1,027 | 21 MB |
| 重庆 | 9×8 | 5,068 | 137 | 4,028 | 422 | 11 MB |
| 成都 | 6×5 | 36,794 | 326 | 3,858 | 478 | 36 MB |
| 西安 | 6×5 | 87,010 | 87 | 2,965 | 1,776 | 116 MB |
| 杭州 | 5×5 | 12,957 | 342 | 3,931 | 1,596 | 18 MB |

### 扩展城市数据
默认瓦片覆盖核心城区（约 10-15 km）。如需扩展到完整都市圈（约 30-40 km）：

```batch
python scripts\tile_downloader.py            # 全部8城
python scripts\tile_downloader.py beijing    # 单城
```

脚本将城市范围按网格分批查询 Overpass API，绕过单次查询限制。

### 更新瓦片数据
```batch
# 重新下载 OSM 数据并切分
python scripts\download_cities.py
python scripts\download_features.py
python scripts\split_to_tiles.py
```

---

## 添加新城市

1. 在 `scripts/tile_downloader.py` 的 `CITIES_EXPANDED` 中添加城市 bbox
2. 在 `js/app.js` 的 `CITIES` 中添加城市中心坐标
3. 在 `index.html` 中添加 `<button class="city-btn" data-city="newcity">新城</button>`
4. 运行 `python scripts\tile_downloader.py newcity` 下载数据
5. 或先用 `download_cities.py` + `split_to_tiles.py` 生成现有范围瓦片

---

## 常见问题

### Q: 地球没有陆地纹理？
A: 运行 `python scripts\download_imagery.py global 3 4` 下载全球低分辨图块。如果仍有问题，检查 ESRI 在线备用是否可达。

### Q: 地形开关无效果？
A: 确保 `data/srtm/` 下有 `.hgt` 文件，且 `pip install numpy quantized-mesh-encoder` 已完成。

### Q: 加载某些城市时出现内存溢出？
A: v4.0 已优化：最大同时 60 块瓦片，GeoJSON 数据用完即弃。如果仍有问题，降低瓦片上限：编辑 `js/TileManager.js` 的 `MAX_LOADED_TILES`。

### Q: 如何停止服务器？
A: 关闭启动的 cmd 窗口，或在终端按 `Ctrl+C`。

### Q: 端口 8080 被占用？
A: 编辑 `scripts/serve.py` 开头的 `PORT` 变量。

---

## 许可

- **源代码**：MIT License
- **建筑/道路/水体/植被数据**：© OpenStreetMap contributors，ODbL License
- **SRTM 地形数据**：NASA/METI/AIST
- **CesiumJS**：Apache 2.0 License
- **卫星图块**：ESRI World Imagery
