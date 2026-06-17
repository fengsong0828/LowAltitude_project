/**
 * 低空巡检系统 - 3D城市可视化 v3.0
 * 建筑 + 地形 + 水体 + 道路 + 植被 + 巡逻
 */

// ============ 8城 ============
const CITIES = {
    beijing:    { name: '北京',   center: { lon: 116.39, lat: 39.9325, alt: 5000 } },
    shanghai:   { name: '上海',   center: { lon: 121.475, lat: 31.24, alt: 5000 } },
    guangzhou:  { name: '广州',   center: { lon: 113.305, lat: 23.13, alt: 5000 } },
    shenzhen:   { name: '深圳',   center: { lon: 114.00, lat: 22.55, alt: 4500 } },
    chongqing:  { name: '重庆',   center: { lon: 106.565, lat: 29.57, alt: 5500 } },
    chengdu:    { name: '成都',   center: { lon: 104.065, lat: 30.66, alt: 4500 } },
    xian:       { name: '西安',   center: { lon: 108.95, lat: 34.27, alt: 5000 } },
    hangzhou:   { name: '杭州',   center: { lon: 120.185, lat: 30.26, alt: 4500 } },
};

// ============ 配置 ============
const CONFIG = {
    terrainUrl: 'http://localhost:8080/terrain/',
    buildingColors: { 60:'#1a1a2e', 40:'#2c3e6b', 25:'#3a7ca5', 15:'#6baed6', 8:'#bdd7ee', 0:'#deebf7' },
    roadStyles: {
        motorway: { color: '#ff6d00', width: 6 }, trunk: { color: '#ff9100', width: 5 },
        primary: { color: '#ffc107', width: 4 }, secondary: { color: '#ffffff', width: 3 },
        tertiary: { color: '#aaaaaa', width: 2 }, residential: { color: '#888888', width: 2 },
    },
};

// ============ 状态 ============
const State = {
    viewer: null,
    currentCity: null,
    // 瓦片管理器
    tileManager: null,
    // v2.0 飞行器管理
    aircraftManager: null,
    alertSystem: null,
    cameraView: null,
    // 建筑/水体/道路/植被 entities（由 TileManager 管理）
    buildingEntities: [],
    waterEntities: [],
    roadEntities: [],
    vegetationEntities: [],
    // 禁飞区
    noflyEntities: [],
    // 图层可见性
    showBuildings: true,
    showWater: true,
    showRoads: true,
    showVegetation: true,
    showAircraft: true,
    showNoFly: false,
    showTerrain: false,
    isSwitching: false,
};

function dom(id) { return document.getElementById(id); }

// ============ Cesium 初始化 ============
function initCesium() {
    // 本地图源（离线可用，零延迟）
    var localProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'http://localhost:8080/imagery/{z}/{x}/{y}.png',
        maximumLevel: 15,
    });
    // ESRI 卫星图（全局备用）
    var esriProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 16,
    });

    State.viewer = new Cesium.Viewer('cesiumContainer', {
        imageryProvider: localProvider,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false, geocoder: false, homeButton: true, sceneModePicker: true,
        navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
        vrButton: false, infoBox: false, selectionIndicator: false,
        targetFrameRate: 60, sceneMode: Cesium.SceneMode.SCENE3D, shadows: false,
    });
    var v = State.viewer;

    // ESRI 作为底层的备用（本地图缺失时透出）
    v.imageryLayers.addImageryProvider(esriProvider);
    // 将 ESRI 移到底层
    v.imageryLayers.lowerToBottom(v.imageryLayers.get(v.imageryLayers.length - 1));

    // 地球外观 — 开启光照使地形有立体感
    v.scene.globe.enableLighting = true;
    v.scene.globe.showGroundAtmosphere = true;
    v.scene.skyAtmosphere.brightnessShift = 0.15;

    // 初始视角：完整地球居中，俯视全貌
    v.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(105, 15, 22000000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });

    var h = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    h.setInputAction(function (m) {
        var c = v.camera.pickEllipsoid(m.endPosition, v.scene.globe.ellipsoid);
        if (c) {
            var g = Cesium.Cartographic.fromCartesian(c);
            dom('stat-coord').textContent = Cesium.Math.toDegrees(g.longitude).toFixed(6) + ', ' + Cesium.Math.toDegrees(g.latitude).toFixed(6);
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    h.setInputAction(function (cl) {
        var p = v.scene.pick(cl.position);
        if (Cesium.defined(p) && p.id && p.id._bld) showTooltip(p.id._bld, cl.position);
        else if (Cesium.defined(p) && p.id && p.id._acData) {
            // v2.0: 点击飞行器
            if (State.aircraftManager) {
                State.aircraftManager.handleClick(p.id);
            }
        }
        else hideTooltip();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    v.camera.changed.addEventListener(updateStatusBar);
}

// ============ 城市切换 (瓦片化) ============
async function switchCity(key) {
    if (State.isSwitching || State.currentCity === key) return;
    State.isSwitching = true;
    const city = CITIES[key];
    console.log('[City]', city.name);

    clearScene();
    State.currentCity = key;

    showLoading(true, city.name + ' - 加载瓦片索引...');
    try {
        await State.tileManager.switchCity(key);

        // v2.0: 加载飞行器
        if (State.aircraftManager) {
            State.aircraftManager.clear();
        }
        setupNoFlyZones();
        updateCityUI(key);
        applyVisibility();

        var center = State.tileManager.getCityCenter();
        State.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.alt),
            orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 2.5,
            complete: function () {
                State.tileManager.forceUpdate();
                // 飞行器在城市加载完成后激活
                if (State.aircraftManager) {
                    State.aircraftManager.loadCity(key);
                }
            },
        });

        dom('stat-buildings').textContent = State.tileManager.getCityBBox() ? '-' : '0';
    } catch (e) {
        console.error('[City] 加载失败:', e);
        showLoading(true, '错误: ' + e.message);
    }

    State.isSwitching = false;
    showLoading(false);
    console.log('[City]', city.name, '就绪 (v2.0 飞行器管理)');
}

function clearScene() {
    const v = State.viewer;
    for (const e of State.buildingEntities) v.entities.remove(e);
    State.buildingEntities = [];
    for (const e of State.waterEntities) v.entities.remove(e);
    State.waterEntities = [];
    for (const e of State.roadEntities) v.entities.remove(e);
    State.roadEntities = [];
    for (const e of State.vegetationEntities) v.entities.remove(e);
    State.vegetationEntities = [];
    for (const e of State.noflyEntities) v.entities.remove(e);
    State.noflyEntities = [];
}

function applyVisibility() {
    if (State.tileManager) {
        State.tileManager.setLayerVisibility('buildings', State.showBuildings);
        State.tileManager.setLayerVisibility('water', State.showWater);
        State.tileManager.setLayerVisibility('roads', State.showRoads);
        State.tileManager.setLayerVisibility('vegetation', State.showVegetation);
    }
    for (const e of State.noflyEntities) e.show = State.showNoFly;
}

function applyVisibility() {
    if (State.tileManager) {
        State.tileManager.setLayerVisibility('buildings', State.showBuildings);
        State.tileManager.setLayerVisibility('water', State.showWater);
        State.tileManager.setLayerVisibility('roads', State.showRoads);
        State.tileManager.setLayerVisibility('vegetation', State.showVegetation);
    }
    for (const e of State.noflyEntities) e.show = State.showNoFly;
}

// ============ 禁飞区 ============
function setupNoFlyZones() {
    const b = State.tileManager.getCityBBox();
    if (!b) return;
    const mx = (b.west + b.east) / 2, my = (b.south + b.north) / 2;
    const dx = (b.east - b.west) * 0.2, dy = (b.north - b.south) * 0.2;
    const zs = [
        { lon: mx - dx, lat: my - dy, r: 200, h: 100, n: '禁飞区 A' },
        { lon: mx + dx * 0.5, lat: my + dy * 0.5, r: 150, h: 80, n: '禁飞区 B' },
        { lon: mx - dx * 0.3, lat: my + dy * 0.3, r: 180, h: 90, n: '禁飞区 C' },
    ];
    for (const z of zs) State.noflyEntities.push(State.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat), name: z.n,
        cylinder: { length: z.h, topRadius: z.r, bottomRadius: z.r, material: Cesium.Color.RED.withAlpha(0.25), outline: true, outlineColor: Cesium.Color.RED.withAlpha(0.6), outlineWidth: 2 },
        label: { text: z.n, font: '12px sans-serif', fillColor: Cesium.Color.RED, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -z.h - 10), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5000) },
    }));
    applyVisibility();
}

// ============ UI ============
function bindUIEvents() {
    dom('toggle-buildings').addEventListener('change', function () { State.showBuildings = this.checked; applyVisibility(); });
    dom('toggle-water').addEventListener('change', function () { State.showWater = this.checked; applyVisibility(); });
    dom('toggle-roads').addEventListener('change', function () { State.showRoads = this.checked; applyVisibility(); });
    dom('toggle-vegetation').addEventListener('change', function () { State.showVegetation = this.checked; applyVisibility(); });
    dom('toggle-aircraft').addEventListener('change', function () {
        State.showAircraft = this.checked;
        if (State.aircraftManager) {
            var entries = State.aircraftManager.aircraft;
            for (var id in entries) {
                if (entries.hasOwnProperty(id) && entries[id].entity) {
                    entries[id].entity.show = State.showAircraft;
                }
            }
        }
    });
    dom('toggle-nofly').addEventListener('change', function () { State.showNoFly = this.checked; applyVisibility(); });
    dom('toggle-terrain').addEventListener('change', function () {
        State.showTerrain = this.checked;
        State.viewer.terrainProvider = State.showTerrain
            ? new Cesium.CesiumTerrainProvider({ url: CONFIG.terrainUrl, requestVertexNormals: false, requestWaterMask: false })
            : new Cesium.EllipsoidTerrainProvider();
    });
    dom('btn-flyto').addEventListener('click', function () {
        var c = CITIES[State.currentCity] && CITIES[State.currentCity].center;
        if (!c) return;
        State.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.alt), orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 }, duration: 1.2 });
    });
    document.querySelectorAll('.city-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            if (this.dataset.city && this.dataset.city !== State.currentCity) switchCity(this.dataset.city);
        });
    });
}

function updateCityUI(key) {
    document.querySelectorAll('.city-btn').forEach(function (b) { b.classList.toggle('city-active', b.dataset.city === key); });
    dom('city-name').textContent = CITIES[key].name;
}

// ============ 辅助 ============
function updateStatusBar() {
    const v = State.viewer;
    if (!v.camera.position) return;
    dom('stat-altitude').textContent = Cesium.Cartographic.fromCartesian(v.camera.position).height.toFixed(0) + ' m';
}
function showTooltip(p, pos) {
    const tt = dom('tooltip');
    tt.innerHTML = '<div class="tt-name">' + (p.name || '未命名建筑') + '</div><div class="tt-info">类型: ' + p.type + '<br>高度: ' + p.height + ' m<br>楼层: ' + (p.levels || '?') + (p.address ? '<br>地址: ' + p.address : '') + '</div>';
    tt.style.display = 'block'; tt.style.top = (pos.y - 60) + 'px'; tt.style.left = (pos.x + 20) + 'px';
}
function hideTooltip() { dom('tooltip').style.display = 'none'; }
function showLoading(s, txt) {
    const o = dom('loadingOverlay');
    if (s) { o.style.display = 'block'; o.querySelector('.loading-text').textContent = txt || '加载中...'; }
    else o.style.display = 'none';
}

// ============ 渲染循环 ============
function startRenderLoop() {
    var t = performance.now(), c = 0;
    State.viewer.scene.preRender.addEventListener(function () { c++; });
    setInterval(function () { var n = performance.now(), e = n - t; dom('stat-fps').textContent = (e > 0 ? Math.round(c * 1000 / e) : 0) + ' fps'; t = n; c = 0; }, 1000);
}

// ============ 主入口 ============
async function main() {
    console.log('低空巡检 v4.0 启动 (瓦片化动态加载)');
    try {
        initCesium();
        bindUIEvents();
        startRenderLoop();

        // 初始化瓦片管理器（暂不加载任何城市）
        State.tileManager = new TileManager(State.viewer, State, {
            buildingColors: CONFIG.buildingColors,
            roadStyles: CONFIG.roadStyles,
        });
        console.log('[TileManager] 已初始化');

        // v2.0: 初始化飞行器管理模块
        State.alertSystem = new AlertSystem();
        State.cameraView = new CameraView();
        State.aircraftManager = new AircraftManager(State.viewer, State, State.alertSystem, State.cameraView);
        console.log('[Aircraft] v2.0 模块已就绪');

        // 飞行器面板点击事件
        document.getElementById('fleet-list').addEventListener('click', function (e) {
            var item = e.target.closest('.fleet-item');
            if (item && State.aircraftManager) {
                var id = item.getAttribute('data-acid');
                State.aircraftManager.selectAircraft(id);
            }
        });

        var v = State.viewer;
        // 从太空远眺完整地球，缓缓转向中国方向
        v.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(105, 20, 18000000),
            orientation: { heading: Cesium.Math.toRadians(-10), pitch: Cesium.Math.toRadians(-80), roll: 0 },
            duration: 3.0,
        });

        showLoading(false);

        State.showNoFly = false;
        dom('toggle-nofly').checked = false;
        applyVisibility();
    } catch (e) { console.error(e); showLoading(true, '错误: ' + e.message); }
}
window.addEventListener('DOMContentLoaded', main);
