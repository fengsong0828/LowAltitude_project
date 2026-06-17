/**
 * AircraftManager v2.1 - 飞行器管理与可视化
 * 统一配置 fleet.json，每城5架，航线轨迹+拖尾+标记
 */
var AircraftManager = (function () {
    'use strict';

    var FLEET_URL = 'data/aircraft/fleet.json';

    function AircraftManager(viewer, state, alertSystem, cameraView) {
        this.viewer = viewer;
        this.state = state;
        this.alertSystem = alertSystem;
        this.cameraView = cameraView;
        this.aircraft = {};       // id → {config, entity, routeEntity, groundRoute, trailPoints}
        this.aircraftList = [];
        this.cityKey = null;
        this.isActive = false;
        this.animFrame = null;
        this.noflyZones = [];     // 禁飞区 [{lon,lat,r,name}]
        this.noflyWarned = {};    // 去重 key
    }

    // ============ 加载 ============
    AircraftManager.prototype.loadCity = async function (cityKey) {
        this.cityKey = cityKey;
        this._debug('loading: ' + cityKey);

        try {
            this._debug('fetching fleet.json...');
            var resp = await fetch(FLEET_URL);
            if (!resp.ok) { this._debug('FETCH FAIL: ' + resp.status); return; }
            this._debug('fetched OK, parsing...');
            var allFleets = await resp.json();
            var acList = allFleets[cityKey];
            if (!acList || acList.length === 0) { this._debug('NO AIRCRAFT for ' + cityKey); return; }
            this._debug('got ' + acList.length + ' aircraft, creating entities...');

            for (var i = 0; i < acList.length; i++) {
                var ac = acList[i];
                var route = ac.route;
                if (!route || route.length < 2) continue;
                ac.currentLat = route[0][1];
                ac.currentLng = route[0][0];
                ac.currentAlt = route[0][2] || 150;
                ac.routeIndex = 0;
                ac.routeProgress = 0;
                ac.heading = 0;
                ac.battery = ac.battery || 100;
                ac.moving = true;
                ac.status = ac.status || 'cruising';
                ac.lowBattery = false;
                ac.trailPoints = [];
                this.aircraft[ac.id] = { config: ac, routeEntity: null };
                this._createEntity(ac);
                this.aircraftList.push(ac);
            }

            this.isActive = true;
            this._startSimulation();
            this._updatePanel();
            this._debug(cityKey + ': ' + acList.length + ' aircraft READY');
            console.log('[Fleet] ' + cityKey + ': ' + acList.length + ' 架就绪');

        } catch (e) {
            this._debug('ERROR: ' + e.message);
            console.error('[Fleet] 加载失败:', e);
        }
    };

    AircraftManager.prototype._debug = function (msg) {
        var el = document.getElementById('debug-panel');
        if (el) el.textContent = '舰队: ' + msg;
        console.log('[Fleet DBG] ' + msg);
    };

    // ============ 创建实体（航线+飞行器+标签） ============
    AircraftManager.prototype._createEntity = function (ac) {
        var color = Cesium.Color.fromCssColorString(ac.color || '#ff6600');

        // 航线：地面投影（贴地，宽线，暗色）
        var routePos2d = [];
        for (var i = 0; i < ac.route.length; i++) {
            routePos2d.push(ac.route[i][0], ac.route[i][1]);
        }
        var groundRoute = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(routePos2d),
                width: 3,
                material: color.withAlpha(0.25),
                clampToGround: true,
            },
        });

        // 航线：空中轨迹（在飞行高度，细线，亮色）
        var routePos3d = [];
        for (var j = 0; j < ac.route.length; j++) {
            routePos3d.push(ac.route[j][0], ac.route[j][1], ac.route[j][2]);
        }
        var routeEntity = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights(routePos3d),
                width: 3,
                material: color.withAlpha(0.6),
                clampToGround: false,
            },
        });

        // 飞行器本体（扁平椭圆碟）
        var entity = this.viewer.entities.add({
            id: 'ac_' + ac.id,
            position: Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt),
            ellipsoid: {
                radii: new Cesium.Cartesian3(20, 20, 4),
                material: color.withAlpha(0.9),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
                outlineWidth: 1,
            },
            label: {
                text: ac.callsign,
                font: 'bold 13px "Microsoft YaHei", sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString('#1a1a2e'),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -28),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50000),
                scale: 0.9,
            },
        });
        entity._acData = ac;

        // 拖尾（简化：节流更新）
        var trailEntity = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights([]),
                width: 2,
                material: color.withAlpha(0.3),
                clampToGround: false,
            },
        });
        trailEntity._trailAc = ac;
        trailEntity._trailLastUpdate = 0;

        this.aircraft[ac.id].entity = entity;
        this.aircraft[ac.id].routeEntity = routeEntity;
        this.aircraft[ac.id].groundRoute = groundRoute;
        this.aircraft[ac.id].trailEntity = trailEntity;
    };

    // ============ 仿真 ============
    AircraftManager.prototype._startSimulation = function () {
        if (this.animFrame) return;
        var self = this;
        var lastTime = Date.now();
        var tickCount = 0;

        function tick() {
            if (!self.isActive) { self._debug('SIM STOPPED: isActive=false'); return; }
            var dt = Math.min((Date.now() - lastTime) / 1000, 0.3);
            lastTime = Date.now();
            self._updateAll(dt);
            tickCount++;
            if (tickCount % 60 === 0) {
                self._debug('SIM tick=' + tickCount + ' ac=' + self.aircraftList.length + ' dt=' + dt.toFixed(3));
            }
            self.animFrame = requestAnimationFrame(tick);
        }
        this.animFrame = requestAnimationFrame(tick);
        this._debug('SIM STARTED');
    };

    AircraftManager.prototype._updateAll = function (dt) {
        for (var i = 0; i < this.aircraftList.length; i++) {
            var ac = this.aircraftList[i];
            if (ac.moving && ac.route && ac.route.length >= 2) {
                this._moveAircraft(ac, dt);
            }
            this._updateBattery(ac, dt);
            this._updateTrail(ac);
            this._checkNoFlyZone(ac);
        }
        // 节流：最多每 500ms 刷新一次面板
        var now = Date.now();
        if (!this._lastPanelUpdate || now - this._lastPanelUpdate > 500) {
            this._updatePanel();
            this._lastPanelUpdate = now;
        }
    };

    AircraftManager.prototype._moveAircraft = function (ac, dt) {
        var route = ac.route;
        var idx = ac.routeIndex, prog = ac.routeProgress, spd = ac.speed || 20;
        var p0 = route[idx], p1 = route[(idx + 1) % route.length];
        var dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
        var segM = Math.sqrt(dLon * dLon + (p1[1] - p0[1]) * (p1[1] - p0[1])) * 111000;
        prog += (segM > 0 ? (spd * dt) / segM : 1);

        while (prog >= 1) {
            prog -= 1;
            idx = (idx + 1) % route.length;
            p0 = route[idx]; p1 = route[(idx + 1) % route.length];
            dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
            segM = Math.sqrt(dLon * dLon + (p1[1] - p0[1]) * (p1[1] - p0[1])) * 111000;
            if (segM <= 0) { prog = 0; break; }
        }
        ac.routeIndex = idx % route.length;
        ac.routeProgress = Math.max(0, Math.min(1, prog));

        p0 = route[ac.routeIndex]; p1 = route[(ac.routeIndex + 1) % route.length];
        var t = ac.routeProgress;
        ac.currentLng = p0[0] + (p1[0] - p0[0]) * t;
        ac.currentLat = p0[1] + (p1[1] - p0[1]) * t;
        ac.currentAlt = (p0[2] || 150) + ((p1[2] || 150) - (p0[2] || 150)) * t;
        ac.heading = (Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI + 360) % 360;

        var entry = this.aircraft[ac.id];
        if (entry && entry.entity) {
            entry.entity.position = Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt);
            if (this.selectedId === ac.id && !this._lastPosLog || Date.now() - (this._lastPosLog || 0) > 5000) {
                this._lastPosLog = Date.now();
                this._debug('POS: ' + ac.callsign + ' @ ' + ac.currentLat.toFixed(4) + ',' + ac.currentLng.toFixed(4) + ' h=' + ac.currentAlt.toFixed(0));
            }
        }
        if (this.cameraView && this.cameraView.activeAircraft === ac.id) {
            this.cameraView.updatePosition(ac.currentLat, ac.currentLng);
        }
    };

    AircraftManager.prototype._updateBattery = function (ac, dt) {
        ac.battery = Math.max(0, ac.battery - dt * 0.015);
        if (ac.battery < 15 && !ac.lowBattery) {
            ac.lowBattery = true; ac.status = 'returning';
            if (this.alertSystem) this.alertSystem.addAlert({
                level: 'L2', category: 'battery',
                message: ac.callsign + ' 电量不足(' + ac.battery.toFixed(0) + '%)，自动返航',
                droneId: ac.id,
            });
        }
        if (ac.battery <= 0) {
            ac.moving = false; ac.status = 'emergency';
            if (this.alertSystem) this.alertSystem.addAlert({
                level: 'L3', category: 'battery',
                message: ac.callsign + ' 电量耗尽，紧急降落',
                droneId: ac.id,
            });
        }
    };

    AircraftManager.prototype._updateTrail = function (ac) {
        if (!ac.trailPoints) ac.trailPoints = [];
        ac.trailPoints.push([ac.currentLng, ac.currentLat, ac.currentAlt]);
        if (ac.trailPoints.length > 30) ac.trailPoints.shift();

        // 节流：每 1 秒更新拖尾 polyline
        var now = Date.now();
        var entry = this.aircraft[ac.id];
        if (entry && entry.trailEntity) {
            var te = entry.trailEntity;
            if (!te._trailLastUpdate || now - te._trailLastUpdate > 1000) {
                te._trailLastUpdate = now;
                if (ac.trailPoints.length >= 2) {
                    var pts = [];
                    for (var j = 0; j < ac.trailPoints.length; j++) {
                        pts.push(ac.trailPoints[j][0], ac.trailPoints[j][1], ac.trailPoints[j][2]);
                    }
                    te.polyline.positions = Cesium.Cartesian3.fromDegreesArrayHeights(pts);
                }
            }
        }
    };

    // ============ 禁飞区检测 ============
    AircraftManager.prototype.setNoFlyZones = function (zones) {
        this.noflyZones = zones || [];
    };

    AircraftManager.prototype._checkNoFlyZone = function (ac) {
        if (!this.noflyZones || this.noflyZones.length === 0) return;
        for (var i = 0; i < this.noflyZones.length; i++) {
            var z = this.noflyZones[i];
            var dLat = (ac.currentLat - z.lat) * 111000;
            var dLon = (ac.currentLng - z.lon) * 111000 * Math.cos(z.lat * Math.PI / 180);
            var dist = Math.sqrt(dLat * dLat + dLon * dLon);
            var key = ac.id + '_' + z.n;

            if (dist < z.r && !this.noflyWarned[key]) {
                this.noflyWarned[key] = Date.now();
                if (this.alertSystem) {
                    this.alertSystem.addAlert({
                        level: 'L3', category: 'fence',
                        message: ac.callsign + ' 闯入' + z.n + '！距离中心' + dist.toFixed(0) + 'm',
                        droneId: ac.id,
                    });
                }
                ac.status = 'emergency';
            }
            // 接近告警（1.5倍半径）
            if (dist < z.r * 1.5 && dist >= z.r) {
                var warnKey = 'warn_' + key;
                if (!this.noflyWarned[warnKey]) {
                    this.noflyWarned[warnKey] = Date.now();
                    if (this.alertSystem) {
                        this.alertSystem.addAlert({
                            level: 'L1', category: 'fence',
                            message: ac.callsign + ' 接近' + z.n + ' (' + dist.toFixed(0) + 'm)',
                            droneId: ac.id,
                        });
                    }
                }
            }
        }
    };

    // ============ 选中/详情/追踪 ============
    AircraftManager.prototype.selectAircraft = function (id) {
        var ac = this.aircraftList.find(function (a) { return a.id === id; });
        if (!ac) return;

        // 切换追踪：再次点击同一个飞行器取消追踪
        if (this.selectedId === id && this.viewer.trackedEntity) {
            this._untrack();
            return;
        }

        this.selectedId = id;
        this._showDetail(ac);
        this._updatePanel();
        if (this.cameraView) this.cameraView.show(ac.id, ac.callsign, ac.currentLat, ac.currentLng);

        // 追踪飞行器（camera 跟随）
        var entry = this.aircraft[id];
        if (entry && entry.entity) {
            this.viewer.trackedEntity = entry.entity;
        }
    };

    AircraftManager.prototype._untrack = function () {
        this.viewer.trackedEntity = undefined;
        this.selectedId = null;
        this._updatePanel();
        if (this.cameraView) this.cameraView.hide();
    };

    AircraftManager.prototype._showDetail = function (ac) {
        var panel = document.getElementById('ac-detail');
        if (!panel) return;
        var sc = { 'cruising': '#00cc66', 'returning': '#ff8800', 'hovering': '#4488ff', 'emergency': '#ff0000', 'ground': '#888' };
        var st = { 'cruising': '巡航中', 'returning': '返航中', 'hovering': '悬停', 'emergency': '紧急', 'ground': '地面' };
        panel.innerHTML =
            '<div class="ac-detail-header"><span class="ac-dot" style="background:' + ac.color + '"></span>' + ac.callsign + ' <span style="color:#888;font-size:11px">' + ac.typeName + '</span></div>' +
            '<div class="ac-detail-grid">' +
            '<div><span>状态</span><span style="color:' + (sc[ac.status] || '#888') + '">' + (st[ac.status] || ac.status) + '</span></div>' +
            '<div><span>高度</span><span>' + ac.currentAlt.toFixed(0) + ' m</span></div>' +
            '<div><span>速度</span><span>' + ac.speed + ' m/s</span></div>' +
            '<div><span>航向</span><span>' + ac.heading.toFixed(0) + '°</span></div>' +
            '<div><span>电量</span><span style="color:' + (ac.battery < 20 ? '#f44' : '#0c6') + '">' + ac.battery.toFixed(0) + '%</span></div>' +
            '</div>';
    };

    // ============ 面板 ============
    AircraftManager.prototype._updatePanel = function () {
        var panel = document.getElementById('fleet-list');
        if (!panel) return;
        var html = '';
        for (var i = 0; i < this.aircraftList.length; i++) {
            var ac = this.aircraftList[i];
            var sel = this.selectedId === ac.id ? ' fleet-selected' : '';
            var bc = ac.battery > 50 ? '#0c6' : ac.battery > 20 ? '#fa0' : '#f44';
            html += '<div class="fleet-item' + sel + '" data-acid="' + ac.id + '">' +
                '<span class="fleet-dot" style="background:' + ac.color + '"></span>' +
                '<div class="fleet-info"><div class="fleet-name">' + ac.callsign + '</div><div class="fleet-type">' + ac.typeName + ' · ' + ac.currentAlt.toFixed(0) + 'm</div></div>' +
                '<div class="fleet-battery"><span style="color:' + bc + '">' + ac.battery.toFixed(0) + '%</span><div class="fleet-bar"><div class="fleet-bar-fill" style="width:' + ac.battery + '%;background:' + bc + '"></div></div></div>' +
                '</div>';
        }
        panel.innerHTML = html || '<div class="fp-empty">暂无飞行器</div>';

        var stat = document.getElementById('fleet-stats');
        if (stat) stat.textContent = '在线:' + this.aircraftList.length;
    };

    // ============ 清除 ============
    AircraftManager.prototype.clear = function () {
        this.isActive = false;
        if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
        this.viewer.trackedEntity = undefined;
        this.noflyZones = [];
        this.noflyWarned = {};
        for (var id in this.aircraft) {
            var e = this.aircraft[id];
            if (e.entity) this.viewer.entities.remove(e.entity);
            if (e.routeEntity) this.viewer.entities.remove(e.routeEntity);
            if (e.groundRoute) this.viewer.entities.remove(e.groundRoute);
            if (e.trailEntity) this.viewer.entities.remove(e.trailEntity);
        }
        this.aircraft = {}; this.aircraftList = []; this.selectedId = null;
        var p = document.getElementById('fleet-list'); if (p) p.innerHTML = '<div class="fp-empty">请选择城市</div>';
        var d = document.getElementById('ac-detail'); if (d) d.innerHTML = '<div class="ac-detail-empty">点击飞行器查看详情</div>';
        if (this.cameraView) this.cameraView.hide();
    };

    AircraftManager.prototype.handleClick = function (entity) {
        if (entity && entity._acData) { this.selectAircraft(entity._acData.id); return true; }
        return false;
    };

    return AircraftManager;
})();
