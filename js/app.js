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
    defaultPatrolSpeed: 10,
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
    // 建筑/水体/道路/植被 entities（由 TileManager 管理）
    buildingEntities: [],
    waterEntities: [],
    roadEntities: [],
    vegetationEntities: [],
    // 巡逻
    droneEntity: null,
    dronePath: null,
    waypointEntities: [],
    noflyEntities: [],
    patrolRoutes: [],
    activeRouteIndex: 0,
    isPatrolPlaying: false,
    patrolSpeed: CONFIG.defaultPatrolSpeed,
    animationStartTime: null,
    // 图层可见性
    showBuildings: true,
    showWater: true,
    showRoads: true,
    showVegetation: true,
    showPatrol: false,
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
        else hideTooltip();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    v.camera.changed.addEventListener(updateStatusBar);
}

// ============ 城市切换 (瓦片化) ============
async function switchCity(key) {
    if (State.isSwitching || State.currentCity === key) return;
    State.isSwitching = true;
    stopPatrol();
    const city = CITIES[key];
    console.log('[City]', city.name);

    clearScene();
    State.currentCity = key;

    showLoading(true, city.name + ' - 加载瓦片索引...');
    try {
        await State.tileManager.switchCity(key);

        setupPatrolRoutes();
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
            },
        });

        dom('stat-buildings').textContent = State.tileManager.getCityBBox() ? '-' : '0';
    } catch (e) {
        console.error('[City] 加载失败:', e);
        showLoading(true, '错误: ' + e.message);
    }

    State.isSwitching = false;
    showLoading(false);
    console.log('[City]', city.name, '就绪 (瓦片模式)');
}

function clearScene() {
    const v = State.viewer;
    // TileManager 的瓦片数据在 switchCity 时已被清理
    for (const e of State.buildingEntities) v.entities.remove(e);
    State.buildingEntities = [];
    for (const e of State.waterEntities) v.entities.remove(e);
    State.waterEntities = [];
    for (const e of State.roadEntities) v.entities.remove(e);
    State.roadEntities = [];
    for (const e of State.vegetationEntities) v.entities.remove(e);
    State.vegetationEntities = [];
    for (const e of State.waypointEntities) v.entities.remove(e);
    State.waypointEntities = [];
    for (const e of State.noflyEntities) v.entities.remove(e);
    State.noflyEntities = [];
    if (State.droneEntity) { v.entities.remove(State.droneEntity); State.droneEntity = null; }
    if (State.dronePath) { v.entities.remove(State.dronePath); State.dronePath = null; }
}

function applyVisibility() {
    if (State.tileManager) {
        State.tileManager.setLayerVisibility('buildings', State.showBuildings);
        State.tileManager.setLayerVisibility('water', State.showWater);
        State.tileManager.setLayerVisibility('roads', State.showRoads);
        State.tileManager.setLayerVisibility('vegetation', State.showVegetation);
    }
    if (State.dronePath) State.dronePath.show = State.showPatrol;
    if (State.droneEntity) State.droneEntity.show = State.showPatrol;
    for (const e of State.waypointEntities) e.show = State.showPatrol;
    for (const e of State.noflyEntities) e.show = State.showNoFly;
}

// ============ 巡逻路线 ============
function setupPatrolRoutes() {
    const b = State.tileManager.getCityBBox();
    if (!b) return;
    const cx = (b.west + b.east) / 2, cy = (b.south + b.north) / 2;
    const r = Math.max(b.east - b.west, b.north - b.south) * 0.5;

    const r1 = [];
    for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        r1.push({ lon: cx + Math.cos(a) * r, lat: cy + Math.sin(a) * r * 0.7,
                  alt: 150 + Math.sin(i * 0.5) * 30, name: i === 0 ? '起点' : 'WP' + i });
    }
    const r2 = [];
    for (let row = 0; row < 5; row++) {
        const t = row / 4, lat = b.south + t * (b.north - b.south);
        const l0 = row % 2 === 0 ? b.west + r * 0.1 : b.east - r * 0.1;
        const l1 = row % 2 === 0 ? b.east - r * 0.1 : b.west + r * 0.1;
        for (let p = 0; p <= 4; p++) r2.push({ lon: l0 + (l1 - l0) * (p / 4), lat, alt: 130 + (row % 3) * 20, name: 'S' + row + '-' + p });
    }
    State.patrolRoutes = [
        { id: 'route1', name: '环形巡逻', color: '#00ff88', points: r1 },
        { id: 'route2', name: '网格扫描', color: '#ff9100', points: r2 },
    ];
    State.activeRouteIndex = 0;
    renderPatrolRoute(0);
    createDrone();
}

function renderPatrolRoute(idx) {
    for (const w of State.waypointEntities) State.viewer.entities.remove(w);
    State.waypointEntities = [];
    if (State.dronePath) { State.viewer.entities.remove(State.dronePath); State.dronePath = null; }
    const rt = State.patrolRoutes[idx];
    if (!rt) return;
    const pos = []; for (const p of rt.points) pos.push(p.lon, p.lat, p.alt);
    State.dronePath = State.viewer.entities.add({
        polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(pos), width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString(rt.color) }),
            clampToGround: false,
        },
    });
    for (const p of rt.points) {
        if (p.name) State.waypointEntities.push(State.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt + 5),
            point: { pixelSize: 6, color: Cesium.Color.fromCssColorString(rt.color), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
            label: { text: p.name, font: '11px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -10), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000) },
        }));
    }
    dom('route-name').textContent = CITIES[State.currentCity].name + ' - ' + rt.name;
    applyVisibility();
}

function createDrone() {
    if (State.droneEntity) { State.viewer.entities.remove(State.droneEntity); State.droneEntity = null; }
    const rt = State.patrolRoutes[State.activeRouteIndex];
    if (!rt || !rt.points.length) return;
    const pt = rt.points[0];
    State.droneEntity = State.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt),
        ellipsoid: { radii: new Cesium.Cartesian3(3, 3, 0.5), material: Cesium.Color.fromCssColorString('#ff6600').withAlpha(0.9), outline: true, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
        label: { text: '巡检无人机', font: '12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#ff3d00'), outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -20), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000) },
    });
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

// ============ 飞行模拟 ============
function startPatrol() {
    if (!State.patrolRoutes[State.activeRouteIndex]) return;
    State.isPatrolPlaying = true;
    State.animationStartTime = State.viewer.clock.currentTime.clone();
    dom('btn-play').textContent = '暂停';
    dom('btn-play').className = 'btn btn-warning btn-sm';
}
function stopPatrol() {
    State.isPatrolPlaying = false;
    dom('btn-play').textContent = '开始';
    dom('btn-play').className = 'btn btn-success btn-sm';
}

function updateDronePosition() {
    if (!State.isPatrolPlaying || !State.droneEntity) return;
    const rt = State.patrolRoutes[State.activeRouteIndex];
    if (!rt || rt.points.length < 2) return;
    const elapsed = Cesium.JulianDate.secondsDifference(State.viewer.clock.currentTime, State.animationStartTime);
    let total = 0; const segs = [];
    for (let i = 1; i < rt.points.length; i++) {
        const p = rt.points[i], prev = rt.points[i - 1];
        const dl = (p.lon - prev.lon) * Math.cos((p.lat + prev.lat) / 2 * Math.PI / 180);
        segs.push(Math.sqrt(dl * dl + (p.lat - prev.lat) * (p.lat - prev.lat)) * 111000);
        total += segs[segs.length - 1];
    }
    const spd = State.patrolSpeed, pd = (elapsed * spd * 111) % total;
    let td = 0, si = 0;
    for (let i = 0; i < segs.length; i++) { if (td + segs[i] > pd) { si = i; break; } td += segs[i]; }
    const t = segs[si] > 0 ? Math.max(0, Math.min(1, (pd - td) / segs[si])) : 0;
    const p0 = rt.points[si], p1 = rt.points[si + 1] || rt.points[0];
    State.droneEntity.position = Cesium.Cartesian3.fromDegrees(p0.lon + (p1.lon - p0.lon) * t, p0.lat + (p1.lat - p0.lat) * t, p0.alt + (p1.alt - p0.alt) * t);
    dom('stat-speed').textContent = spd + ' m/s';
}

// ============ UI ============
function bindUIEvents() {
    dom('toggle-buildings').addEventListener('change', function () { State.showBuildings = this.checked; applyVisibility(); });
    dom('toggle-water').addEventListener('change', function () { State.showWater = this.checked; applyVisibility(); });
    dom('toggle-roads').addEventListener('change', function () { State.showRoads = this.checked; applyVisibility(); });
    dom('toggle-vegetation').addEventListener('change', function () { State.showVegetation = this.checked; applyVisibility(); });
    dom('toggle-patrol').addEventListener('change', function () { State.showPatrol = this.checked; applyVisibility(); });
    dom('toggle-nofly').addEventListener('change', function () { State.showNoFly = this.checked; applyVisibility(); });
    dom('toggle-terrain').addEventListener('change', function () {
        State.showTerrain = this.checked;
        State.viewer.terrainProvider = State.showTerrain
            ? new Cesium.CesiumTerrainProvider({ url: CONFIG.terrainUrl, requestVertexNormals: false, requestWaterMask: false })
            : new Cesium.EllipsoidTerrainProvider();
    });
    dom('select-route').addEventListener('change', function () {
        State.activeRouteIndex = parseInt(this.value);
        stopPatrol(); renderPatrolRoute(State.activeRouteIndex); createDrone();
    });
    dom('btn-play').addEventListener('click', function () { State.isPatrolPlaying ? stopPatrol() : startPatrol(); });
    dom('btn-reset').addEventListener('click', function () { stopPatrol(); createDrone(); });
    dom('speed-slider').addEventListener('input', function () {
        State.patrolSpeed = parseInt(this.value);
        dom('speed-value').textContent = State.patrolSpeed + ' m/s';
    });
    dom('btn-flyto').addEventListener('click', function () {
        const c = CITIES[State.currentCity].center;
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
    if (!State.isPatrolPlaying) dom('stat-speed').textContent = '0 m/s';
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
    State.viewer.clock.onTick.addEventListener(function () { if (State.isPatrolPlaying) updateDronePosition(); });
    let t = performance.now(), c = 0;
    State.viewer.scene.preRender.addEventListener(function () { c++; });
    setInterval(function () { const n = performance.now(), e = n - t; dom('stat-fps').textContent = (e > 0 ? Math.round(c * 1000 / e) : 0) + ' fps'; t = n; c = 0; }, 1000);
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

        var v = State.viewer;
        // 从太空远眺完整地球，缓缓转向中国方向
        v.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(105, 20, 18000000),
            orientation: { heading: Cesium.Math.toRadians(-10), pitch: Cesium.Math.toRadians(-80), roll: 0 },
            duration: 3.0,
        });

        showLoading(false);

        State.showPatrol = false; State.showNoFly = false;
        dom('toggle-patrol').checked = false;
        dom('toggle-nofly').checked = false;
        applyVisibility();
    } catch (e) { console.error(e); showLoading(true, '错误: ' + e.message); }
}
window.addEventListener('DOMContentLoaded', main);
