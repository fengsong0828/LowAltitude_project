/**
 * TileManager - 瓦片化动态加载系统
 * 按视口可见范围自动加载/卸载城市数据瓦片
 * 替代原有的全量加载方式，实现地图漫游按需拼接
 */
var TileManager = (function () {
    'use strict';

    var TILE_URL_PREFIX = 'data/tiles/';
    var UNLOAD_DELAY_MS = 2000;   // 离开视口后延迟卸载
    var BUFFER_TILES = 0;          // 不预加载外围瓦片
    var UPDATE_THROTTLE_MS = 500;  // 视口变化检测间隔
    var MAX_LOADED_TILES = 8;      // 降至8块
    var MAX_CONCURRENT = 2;        // 并行加载数
    var MAX_TOTAL_ENTITIES = 3000; // 场景总实体硬上限

    function TileManager(viewer, state, config) {
        this.viewer = viewer;
        this.state = state;
        this.config = config || {};

        this.cityIndex = null;
        this.currentCity = null;

        // loadedTiles: key = "layer_col_row" → { entities: [...] }
        this.loadedTiles = {};

        // 当前可见瓦片集合
        this.visibleTileKeys = {};

        // 待卸载瓦片（延迟卸载用）
        this.pendingUnload = {};

        this.lastUpdateTime = 0;
        this.isUpdating = false;
        this.isDestroyed = false;

        // 相机变化监听
        var self = this;
        this._onCameraChange = function () {
            self.update();
        };
        viewer.camera.changed.addEventListener(this._onCameraChange);
    }

    // ============ 城市切换 ============
    TileManager.prototype.switchCity = async function (cityKey) {
        if (this.isDestroyed) return;

        // 卸载当前城市所有瓦片
        this._unloadAll();

        // 加载瓦片索引
        var indexUrl = TILE_URL_PREFIX + cityKey + '/index.json';
        var resp = await fetch(indexUrl);
        if (!resp.ok) throw new Error('无法加载城市索引: ' + cityKey);
        this.cityIndex = await resp.json();
        this.currentCity = cityKey;

        // 重设图层可见性为全部显示
        this.state.showBuildings = true;
        this.state.showWater = true;
        this.state.showRoads = true;
        this.state.showVegetation = true;

        // 不立即加载瓦片 — 等待 camera.flyTo 完成后由 update() 触发
    };

    // ============ 每帧/定期更新 ============
    TileManager.prototype.update = function () {
        if (this.isDestroyed || !this.cityIndex || this.isUpdating) return;

        var now = Date.now();
        if (now - this.lastUpdateTime < UPDATE_THROTTLE_MS) return;
        this.lastUpdateTime = now;

        this._loadVisibleTiles();
    };

    // 强制立即刷新（忽略节流）
    TileManager.prototype.forceUpdate = function () {
        if (this.isDestroyed || !this.cityIndex) return;
        this.lastUpdateTime = 0;
        this._loadVisibleTiles();
    };

    // ============ 计算视口可见瓦片 ============
    TileManager.prototype._computeVisibleTileKeys = function () {
        if (!this.cityIndex) return {};

        var bounds = this._getViewBounds();
        if (!bounds) return {};

        var idx = this.cityIndex;
        var originLon = idx.gridOrigin.lon;
        var originLat = idx.gridOrigin.lat;
        var sizeLon = idx.tileSizeLon;
        var sizeLat = idx.tileSizeLat;

        // 扩展视口范围（加入缓冲）
        var bufLon = sizeLon * BUFFER_TILES;
        var bufLat = sizeLat * BUFFER_TILES;

        var colStart = Math.floor((bounds.west - bufLon - originLon) / sizeLon);
        var colEnd = Math.ceil((bounds.east + bufLon - originLon) / sizeLon);
        var rowStart = Math.floor((bounds.south - bufLat - originLat) / sizeLat);
        var rowEnd = Math.ceil((bounds.north + bufLat - originLat) / sizeLat);

        colStart = Math.max(0, colStart);
        colEnd = Math.min(idx.gridCols - 1, colEnd);
        rowStart = Math.max(0, rowStart);
        rowEnd = Math.min(idx.gridRows - 1, rowEnd);

        var tileKeys = {};
        var layers = idx.availableLayers || ['buildings', 'water', 'roads', 'vegetation'];

        for (var r = rowStart; r <= rowEnd; r++) {
            for (var c = colStart; c <= colEnd; c++) {
                for (var li = 0; li < layers.length; li++) {
                    var key = layers[li] + '_' + c + '_' + r;
                    tileKeys[key] = true;
                }
            }
        }

        return tileKeys;
    };

    // ============ 加载可见瓦片 ============
    TileManager.prototype._loadVisibleTiles = function () {
        var self = this;
        var newVisible = this._computeVisibleTileKeys();

        // 找出需要加载的瓦片（在 newVisible 但不在 loadedTiles 中）
        var toLoad = [];
        for (var key in newVisible) {
            if (newVisible.hasOwnProperty(key) && !self.loadedTiles[key]) {
                toLoad.push(key);
            }
        }

        // 找出需要卸载的瓦片（在 loadedTiles 但不在 newVisible 中）
        var toUnload = [];
        for (var key in self.loadedTiles) {
            if (self.loadedTiles.hasOwnProperty(key) && !newVisible[key]) {
                toUnload.push(key);
            }
        }

        // 清理之前待卸载列表中已重新变为可见的瓦片
        for (var i = 0; i < toLoad.length; i++) {
            var k = toLoad[i];
            if (self.pendingUnload[k]) {
                clearTimeout(self.pendingUnload[k]);
                delete self.pendingUnload[k];
            }
        }

        // 延迟卸载（避免来回拖动时的抖动）
        for (var j = 0; j < toUnload.length; j++) {
            (function (key) {
                if (!self.pendingUnload[key]) {
                    self.pendingUnload[key] = setTimeout(function () {
                        self._unloadTile(key);
                        delete self.pendingUnload[key];
                    }, UNLOAD_DELAY_MS);
                }
            })(toUnload[j]);
        }

        // 异步加载新瓦片（限流 + 总量上限）
        this.visibleTileKeys = newVisible;

        // 如果已加载瓦片数已达上限，跳过（等待旧瓦片卸载）
        var loadedCount = Object.keys(this.loadedTiles).length;
        if (loadedCount >= MAX_LOADED_TILES) return;

        // 场景总实体数硬限制（防止西安等大城市OOM）
        var totalEntities = this.viewer.entities.values.length;
        if (totalEntities > MAX_TOTAL_ENTITIES) return;

        // 限制本次加载数量
        var maxToLoad = MAX_LOADED_TILES - loadedCount;
        if (toLoad.length > maxToLoad) {
            toLoad = toLoad.slice(0, maxToLoad);
        }

        this._loadTileBatch(toLoad);
    };

    TileManager.prototype._loadTileBatch = function (keys) {
        var self = this;
        if (keys.length === 0) return;

        var i = 0;

        function loadNext() {
            if (i >= keys.length || self.isDestroyed) return;
            var batch = keys.slice(i, i + MAX_CONCURRENT);
            i += MAX_CONCURRENT;
            Promise.all(batch.map(function (k) { return self._loadTile(k); }))
                .then(function () { loadNext(); });
        }

        loadNext();
    };

    // ============ 加载单个瓦片 ============
    TileManager.prototype._loadTile = async function (tileKey) {
        if (this.isDestroyed || this.loadedTiles[tileKey]) return;

        var parts = tileKey.split('_');
        // tileKey 格式: "layer_col_row"
        if (parts.length < 3) return;
        var layer = parts[0];
        var col = parts[1];
        var row = parts[2];

        try {
            // 直接请求瓦片数据（不缓存，让 GC 回收）
            var url = TILE_URL_PREFIX + this.currentCity + '/' + layer + '/' + col + '_' + row + '.geojson';
            var resp = await fetch(url);
            if (!resp.ok) return;
            var data = await resp.json();

            var entities = [];
            if (data && data.features && data.features.length > 0) {
                entities = this._renderTileFeatures(layer, data.features);
            }

            // 释放 JSON 引用
            data = null;

            // 如果该瓦片在加载过程中已不再需要，立即卸载
            if (!this.visibleTileKeys[tileKey]) {
                for (var i = 0; i < entities.length; i++) {
                    this.viewer.entities.remove(entities[i]);
                }
                return;
            }

            this.loadedTiles[tileKey] = {
                entities: entities,
            };

            // 加入全局 entity 数组以便图层控制
            this._addToEntityArrays(layer, entities);

            // 应用当前可见性
            this._applyTileVisibility(tileKey);

            // 更新统计
            this._updateStats();

            // console.log('[Tile] 加载: ' + tileKey + ' (' + entities.length + ' 个实体)');

        } catch (e) {
            // 静默处理加载失败
        }
    };

    // ============ 卸载单个瓦片 ============
    TileManager.prototype._unloadTile = function (tileKey) {
        var tile = this.loadedTiles[tileKey];
        if (!tile) return;

        var parts = tileKey.split('_');
        var layer = parts[0];

        // 从 viewer 移除实体
        for (var i = 0; i < tile.entities.length; i++) {
            this.viewer.entities.remove(tile.entities[i]);
        }

        // 从全局 entity 数组移除
        this._removeFromEntityArrays(layer, tile.entities);

        delete this.loadedTiles[tileKey];
        this._updateStats();

        // console.log('[Tile] 卸载: ' + tileKey);
    };

    // ============ 卸载所有瓦片（立即，用于城市切换）============
    TileManager.prototype._unloadAll = function () {
        // 取消所有待卸载定时器
        for (var key in this.pendingUnload) {
            if (this.pendingUnload.hasOwnProperty(key)) {
                clearTimeout(this.pendingUnload[key]);
            }
        }
        this.pendingUnload = {};

        // 立即移除所有已加载瓦片的实体
        var keys = Object.keys(this.loadedTiles);
        for (var i = 0; i < keys.length; i++) {
            var tile = this.loadedTiles[keys[i]];
            if (tile && tile.entities) {
                for (var j = 0; j < tile.entities.length; j++) {
                    this.viewer.entities.remove(tile.entities[j]);
                }
            }
        }
        this.loadedTiles = {};
        this.visibleTileKeys = {};
        this.cityIndex = null;
        this.currentCity = null;
    };

    // ============ 渲染瓦片内的要素 ============
    TileManager.prototype._renderTileFeatures = function (layer, features) {
        var entities = [];

        for (var fi = 0; fi < features.length; fi++) {
            var f = features[fi];
            var entity = null;

            try {
                if (layer === 'buildings') {
                    entity = this._createBuildingEntity(f);
                } else if (layer === 'water') {
                    var waterEntities = this._createWaterEntities(f);
                    if (waterEntities && waterEntities.length > 0) {
                        for (var wi = 0; wi < waterEntities.length; wi++) {
                            entities.push(waterEntities[wi]);
                        }
                    }
                    continue; // 已手动处理
                } else if (layer === 'roads') {
                    entity = this._createRoadEntity(f);
                } else if (layer === 'vegetation') {
                    entity = this._createVegetationEntity(f);
                }
            } catch (e) {
                // 跳过无效几何体
            }

            if (entity) {
                entities.push(entity);
            }
        }

        return entities;
    };

    TileManager.prototype._createBuildingEntity = function (f) {
        var p = f.properties, g = f.geometry;
        if (!g || g.type !== 'Polygon' || !g.coordinates || !g.coordinates[0]) return null;
        var h = p.height || 6;
        var ring = g.coordinates[0];
        var pos = [];
        for (var i = 0; i < ring.length; i++) {
            pos.push(ring[i][0], ring[i][1]);
        }
        if (pos.length < 6) return null;

        var buildingColors = this.config.buildingColors || { 60: '#1a1a2e', 40: '#2c3e6b', 25: '#3a7ca5', 15: '#6baed6', 8: '#bdd7ee', 0: '#deebf7' };
        var heights = Object.keys(buildingColors).map(Number).sort(function (a, b) { return b - a; });
        var color = buildingColors[0];
        for (var k = 0; k < heights.length; k++) {
            if (h >= heights[k]) { color = buildingColors[heights[k]]; break; }
        }

        var e = this.viewer.entities.add({
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(pos),
                height: 0,
                extrudedHeight: h,
                material: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.12),
                outlineWidth: 1,
            },
        });
        e._bld = {
            name: p.name || '',
            height: h,
            type: p.type || '',
            levels: p.levels || '',
            address: p.address || '',
        };
        return e;
    };

    TileManager.prototype._createWaterEntities = function (f) {
        var g = f.geometry;
        if (!g || !g.coordinates) return [];

        if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
            var rings = g.type === 'Polygon' ? [g.coordinates[0]] : [];
            if (g.type === 'MultiPolygon' && g.coordinates) {
                for (var i = 0; i < g.coordinates.length; i++) {
                    if (g.coordinates[i] && g.coordinates[i][0]) {
                        rings.push(g.coordinates[i][0]);
                    }
                }
            }
            var entities = [];
            for (var ri = 0; ri < rings.length; ri++) {
                var ring = rings[ri];
                var pos = [];
                for (var j = 0; j < ring.length; j++) {
                    pos.push(ring[j][0], ring[j][1]);
                }
                if (pos.length < 6) continue;
                var e = this.viewer.entities.add({
                    polygon: {
                        hierarchy: Cesium.Cartesian3.fromDegreesArray(pos),
                        height: 0,
                        material: Cesium.Color.fromCssColorString('#8ecae6').withAlpha(0.55),
                        outline: false,
                    },
                });
                entities.push(e);
            }
            return entities;
        } else if (g.type === 'LineString') {
            var linePos = [];
            for (var k = 0; k < g.coordinates.length; k++) {
                linePos.push(g.coordinates[k][0], g.coordinates[k][1]);
            }
            if (linePos.length < 4) return [];
            return [this.viewer.entities.add({
                polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(linePos),
                    width: 4,
                    material: Cesium.Color.fromCssColorString('#2196f3').withAlpha(0.7),
                    clampToGround: true,
                },
            })];
        }
        return [];
    };

    TileManager.prototype._createRoadEntity = function (f) {
        var g = f.geometry;
        if (!g || g.type !== 'LineString' || !g.coordinates) return null;

        var roadType = f.properties.type || 'tertiary';
        var roadStyles = this.config.roadStyles || {
            motorway: { color: '#ff6d00', width: 6 },
            trunk: { color: '#ff9100', width: 5 },
            primary: { color: '#ffc107', width: 4 },
            secondary: { color: '#ffffff', width: 3 },
            tertiary: { color: '#aaaaaa', width: 2 },
            residential: { color: '#888888', width: 2 },
        };
        var style = roadStyles[roadType] || roadStyles.residential;

        var pos = [];
        for (var i = 0; i < g.coordinates.length; i++) {
            pos.push(g.coordinates[i][0], g.coordinates[i][1]);
        }
        if (pos.length < 4) return null;

        return this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(pos),
                width: style.width,
                material: Cesium.Color.fromCssColorString(style.color).withAlpha(0.85),
                clampToGround: true,
                zIndex: roadType === 'motorway' ? 10 : roadType === 'trunk' ? 8 : roadType === 'primary' ? 6 : 4,
            },
        });
    };

    TileManager.prototype._createVegetationEntity = function (f) {
        var g = f.geometry;
        if (!g || g.type !== 'Polygon' || !g.coordinates || !g.coordinates[0]) return null;

        var ring = g.coordinates[0];
        var pos = [];
        for (var i = 0; i < ring.length; i++) {
            pos.push(ring[i][0], ring[i][1]);
        }
        if (pos.length < 6) return null;

        var vegType = f.properties.type;
        var alpha = (vegType === 'forest' || vegType === 'wood') ? 0.4 : 0.3;
        var color = (vegType === 'forest' || vegType === 'wood') ? '#388e3c' : '#66bb6a';

        return this.viewer.entities.add({
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(pos),
                height: 1,
                material: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
                outline: false,
            },
        });
    };

    // ============ Entity 数组管理 ============
    TileManager.prototype._addToEntityArrays = function (layer, entities) {
        if (!entities || entities.length === 0) return;
        var arr = null;
        switch (layer) {
            case 'buildings': arr = this.state.buildingEntities; break;
            case 'water': arr = this.state.waterEntities; break;
            case 'roads': arr = this.state.roadEntities; break;
            case 'vegetation': arr = this.state.vegetationEntities; break;
        }
        if (arr) {
            for (var i = 0; i < entities.length; i++) {
                arr.push(entities[i]);
            }
        }
    };

    TileManager.prototype._removeFromEntityArrays = function (layer, entities) {
        if (!entities || entities.length === 0) return;
        var arr = null;
        switch (layer) {
            case 'buildings': arr = this.state.buildingEntities; break;
            case 'water': arr = this.state.waterEntities; break;
            case 'roads': arr = this.state.roadEntities; break;
            case 'vegetation': arr = this.state.vegetationEntities; break;
        }
        if (arr) {
            var entitySet = {};
            for (var i = 0; i < entities.length; i++) {
                entitySet[entities[i].id] = true;
            }
            // 过滤移除
            for (var j = arr.length - 1; j >= 0; j--) {
                if (entitySet[arr[j].id]) {
                    arr.splice(j, 1);
                }
            }
        }
    };

    // ============ 图层可见性 ============
    TileManager.prototype._applyTileVisibility = function (tileKey) {
        var parts = tileKey.split('_');
        var layer = parts[0];
        var show = true;
        switch (layer) {
            case 'buildings': show = this.state.showBuildings; break;
            case 'water': show = this.state.showWater; break;
            case 'roads': show = this.state.showRoads; break;
            case 'vegetation': show = this.state.showVegetation; break;
        }
        var tile = this.loadedTiles[tileKey];
        if (tile) {
            for (var i = 0; i < tile.entities.length; i++) {
                tile.entities[i].show = show;
            }
        }
    };

    TileManager.prototype.setLayerVisibility = function (layer, visible) {
        // 更新已加载瓦片中该图层的实体显示状态
        for (var key in this.loadedTiles) {
            if (this.loadedTiles.hasOwnProperty(key) && key.indexOf(layer + '_') === 0) {
                var tile = this.loadedTiles[key];
                for (var i = 0; i < tile.entities.length; i++) {
                    tile.entities[i].show = visible;
                }
            }
        }
    };

    // ============ 视口范围计算 ============
    TileManager.prototype._getViewBounds = function () {
        var camera = this.viewer.camera;
        var ellipsoid = this.viewer.scene.globe.ellipsoid;

        // 优先使用 Cesium 内置方法
        var rect = camera.computeViewRectangle(ellipsoid);
        if (rect) {
            return {
                west: Cesium.Math.toDegrees(rect.west),
                south: Cesium.Math.toDegrees(rect.south),
                east: Cesium.Math.toDegrees(rect.east),
                north: Cesium.Math.toDegrees(rect.north),
            };
        }

        // 回退：从相机位置和高度估算
        var cart = camera.position;
        var carto = Cesium.Cartographic.fromCartesian(cart);
        if (!carto) return null;

        var camLon = Cesium.Math.toDegrees(carto.longitude);
        var camLat = Cesium.Math.toDegrees(carto.latitude);
        var camAlt = carto.height;

        // 根据高度估算视口大小
        // 在 5000m 高度，FOV约60°，视口宽度约 5000*2*tan(30°) ≈ 5800m ≈ 0.05°
        // 在 50000m 高度，视口宽度约 0.5°
        var viewSpanDeg = (camAlt / 111000) * 1.2; // 粗略估算
        viewSpanDeg = Math.max(viewSpanDeg, 0.02);

        // 根据pitch调整：俯视时视口更集中
        var pitch = camera.pitch;
        var pitchFactor = Math.abs(Math.cos(pitch));
        if (pitchFactor < 0.01) pitchFactor = 0.01;

        var spanLon = viewSpanDeg / pitchFactor;
        var spanLat = spanLon * 0.6;

        return {
            west: camLon - spanLon,
            south: camLat - spanLat,
            east: camLon + spanLon,
            north: camLat + spanLat,
        };
    };

    // ============ 统计更新 ============
    TileManager.prototype._updateStats = function () {
        var counts = { buildings: 0, water: 0, roads: 0, vegetation: 0 };
        for (var key in this.loadedTiles) {
            if (this.loadedTiles.hasOwnProperty(key)) {
                var tile = this.loadedTiles[key];
                if (key.indexOf('buildings_') === 0) counts.buildings += tile.entities.length;
                else if (key.indexOf('water_') === 0) counts.water += tile.entities.length;
                else if (key.indexOf('roads_') === 0) counts.roads += tile.entities.length;
                else if (key.indexOf('vegetation_') === 0) counts.vegetation += tile.entities.length;
            }
        }

        // 更新 DOM（如果存在）
        var panelBuildings = document.getElementById('panel-buildings');
        var panelWater = document.getElementById('panel-water');
        var panelRoads = document.getElementById('panel-roads');
        var panelVegetation = document.getElementById('panel-vegetation');
        var statBuildings = document.getElementById('stat-buildings');

        if (panelBuildings) panelBuildings.textContent = counts.buildings;
        if (panelWater) panelWater.textContent = counts.water;
        if (panelRoads) panelRoads.textContent = counts.roads;
        if (panelVegetation) panelVegetation.textContent = counts.vegetation;
        if (statBuildings) statBuildings.textContent = counts.buildings;
    };

    // ============ 公共API ============
    TileManager.prototype.getCityBBox = function () {
        if (this.cityIndex && this.cityIndex.bbox) {
            return this.cityIndex.bbox;
        }
        return null;
    };

    TileManager.prototype.getCityCenter = function () {
        if (this.cityIndex && this.cityIndex.center) {
            return this.cityIndex.center;
        }
        return null;
    };

    TileManager.prototype.getLoadedTileCount = function () {
        return Object.keys(this.loadedTiles).length;
    };

    TileManager.prototype.destroy = function () {
        this.isDestroyed = true;
        this.viewer.camera.changed.removeEventListener(this._onCameraChange);
        this._unloadAll();
    };

    return TileManager;
})();
