/**
 * AircraftManager v2.1 - 飞行器管理与可视化
 * 统一配置 fleet.json，每城5架，航线轨迹+拖尾+标记
 */
var AircraftManager = (function () {
    'use strict';

    var FLEET_URL = 'data/aircraft/';  // 按城市分文件 {city}.json

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
        this.gridEntities = [];   // 空域网格实体
        this.showGrid = false;
    }

    // ============ 加载 ============
    AircraftManager.prototype.loadCity = async function (cityKey) {
        this.cityKey = cityKey;
        this._debug('loading: ' + cityKey);

        try {
            this._debug('fetching ' + cityKey + '.json...');
            var resp = await fetch(FLEET_URL + cityKey + '.json');
            if (!resp.ok) { this._debug('FETCH FAIL: ' + resp.status); return; }
            this._debug('fetched OK, parsing...');
            var data = await resp.json();
            var acList = data.aircraft || [];
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

    // ============ 创建实体（图标+航线+标签） ============
    AircraftManager.prototype._createEntity = function (ac) {
        var colorHex = ac.color || '#ff6600';
        var color = Cesium.Color.fromCssColorString(colorHex);

        // 图标：发光的彩色圆形 Billboard
        var iconUrl = this._makeCircleIcon(colorHex);
        var entity = this.viewer.entities.add({
            id: 'ac_' + ac.id,
            position: Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt),
            billboard: {
                image: iconUrl,
                width: 36,
                height: 36,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(0, 1.2, 30000, 0.4),
            },
            point: {
                pixelSize: 10,
                color: color.withAlpha(0.8),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                scaleByDistance: new Cesium.NearFarScalar(10000, 1.5, 100000, 0.3),
            },
            label: {
                text: ac.callsign,
                font: 'bold 12px "Microsoft YaHei", sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString('#1a1a2e'),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -24),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 40000),
            },
        });
        entity._acData = ac;

        // 航线：贴地投影（暗色 + 虚点效果）
        var routePos2d = [];
        for (var i = 0; i < ac.route.length; i++) {
            routePos2d.push(ac.route[i][0], ac.route[i][1]);
        }
        var groundRoute = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(routePos2d),
                width: 3,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: color.withAlpha(0.35),
                    dashLength: 16,
                }),
                clampToGround: true,
            },
        });

        // 航线：空中轨迹（实线亮色）
        var routePos3d = [];
        for (var j = 0; j < ac.route.length; j++) {
            routePos3d.push(ac.route[j][0], ac.route[j][1], ac.route[j][2]);
        }
        var routeEntity = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights(routePos3d),
                width: 3,
                material: color.withAlpha(0.7),
                clampToGround: false,
            },
        });

        // 拖尾（节流更新）
        var trailEntity = this.viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights([]),
                width: 2,
                material: color.withAlpha(0.4),
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

    // 生成发光圆形图标（Canvas → data URI）
    AircraftManager.prototype._makeCircleIcon = function (colorHex) {
        var key = '_icon_' + colorHex;
        if (!AircraftManager._iconCache) AircraftManager._iconCache = {};
        if (AircraftManager._iconCache[key]) return AircraftManager._iconCache[key];

        var size = 64;
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');

        var cx = size / 2, cy = size / 2;
        // 外层光晕
        var grad = ctx.createRadialGradient(cx, cy, size * 0.15, cx, cy, size * 0.48);
        grad.addColorStop(0, colorHex);
        grad.addColorStop(0.4, colorHex + 'CC');
        grad.addColorStop(0.7, colorHex + '40');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // 实心圆
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = colorHex;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        var uri = canvas.toDataURL();
        AircraftManager._iconCache[key] = uri;
        return uri;
    };

    // ============ 仿真 ============
    AircraftManager.prototype._startSimulation = function () {
        if (this.animFrame) return;
        var self = this;
        var lastTime = Date.now();
        var tickCount = 0;

        function tick() {
            if (!self.isActive) { self._debug('SIM STOPPED: isActive=false'); return; }
            try {
                var dt = Math.min((Date.now() - lastTime) / 1000, 0.3);
                lastTime = Date.now();
                self._updateAll(dt);
                tickCount++;
                if (tickCount % 120 === 0) {
                    self._debug('SIM t=' + tickCount + ' ac=' + self.aircraftList.length + ' dt=' + dt.toFixed(3));
                }
            } catch (e) {
                self._debug('SIM ERROR: ' + e.message);
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
            this._updateCommLoss(ac, dt);
        }
        this._detectConflicts(dt);
        // 节流：最多每 500ms 刷新一次面板
        var now = Date.now();
        if (!this._lastPanelUpdate || now - this._lastPanelUpdate > 500) {
            this._updatePanel();
            this._lastPanelUpdate = now;
        }
        this.updateGrid();
    };

    AircraftManager.prototype._moveAircraft = function (ac, dt) {
        var route = ac.route;
        var idx = ac.routeIndex, prog = ac.routeProgress, spd = ac.speed || 20;
        var direction = (ac.status === 'returning') ? -1 : 1;  // 返航时倒退
        var effectiveSpeed = (ac.status === 'returning') ? spd * 0.6 : spd;  // 返航减速

        var segCount = route.length;
        var p0 = route[idx];
        var nextIdx = (idx + direction + segCount) % segCount;
        var p1 = route[nextIdx];

        var dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
        var segM = Math.sqrt(dLon * dLon + (p1[1] - p0[1]) * (p1[1] - p0[1])) * 111000;
        prog += (segM > 0 ? (effectiveSpeed * dt) / segM : 1);

        while (prog >= 1) {
            prog -= 1;
            idx = (idx + direction + segCount) % segCount;
            p0 = route[idx];
            nextIdx = (idx + direction + segCount) % segCount;
            p1 = route[nextIdx];
            dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
            segM = Math.sqrt(dLon * dLon + (p1[1] - p0[1]) * (p1[1] - p0[1])) * 111000;
            if (segM <= 0) { prog = 0; break; }
        }
        ac.routeIndex = (idx + segCount) % segCount;
        ac.routeProgress = Math.max(0, Math.min(1, prog));

        p0 = route[ac.routeIndex];
        nextIdx = (ac.routeIndex + direction + segCount) % segCount;
        p1 = route[nextIdx];
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
            this.cameraView.updatePosition(ac.currentLat, ac.currentLng, ac.heading);
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
        if (ac.battery <= 0 && ac.status !== 'emergency') {
            ac.moving = false; ac.status = 'emergency';
            if (this.alertSystem) this.alertSystem.addAlert({
                level: 'L3', category: 'battery',
                message: ac.callsign + ' 电量耗尽，紧急降落',
                droneId: ac.id,
            });
        }
        // 紧急降落：高度逐渐降至 0
        if (ac.status === 'emergency') {
            ac.currentAlt = Math.max(0, ac.currentAlt - dt * 5);
            var entry2 = this.aircraft[ac.id];
            if (entry2 && entry2.entity) {
                entry2.entity.position = Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt);
            }
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
        var anyWarning = false;
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
            if (dist < z.r * 1.5) anyWarning = true;

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
        // 所有禁飞区都安全了，清除该飞行器的围栏告警
        if (!anyWarning && this.alertSystem) {
            this.alertSystem.clearByDrone(ac.id, 'fence');
        }
    };

    // ============ 冲突检测（两两距离） ============
    AircraftManager.prototype._detectConflicts = function (dt) {
        if (!this._conflictPairs) this._conflictPairs = {};
        var active = this.aircraftList.filter(function (a) { return a.status !== 'ground' && a.status !== 'emergency'; });
        for (var i = 0; i < active.length; i++) {
            for (var j = i + 1; j < active.length; j++) {
                var a = active[i], b = active[j];
                var dLat = (a.currentLat - b.currentLat) * 111000;
                var dLon = (a.currentLng - b.currentLng) * 111000 * Math.cos((a.currentLat + b.currentLat) / 2 * Math.PI / 180);
                var dist = Math.sqrt(dLat * dLat + dLon * dLon);
                var vsep = Math.abs(a.currentAlt - b.currentAlt);
                var pairKey = a.id < b.id ? a.id + '-' + b.id : b.id + '-' + a.id;

                if (dist < 200 && vsep < 60) {
                    var level = dist < 50 ? 'L3' : dist < 100 ? 'L2' : 'L1';
                    if (!this._conflictPairs[pairKey]) {
                        this._conflictPairs[pairKey] = Date.now();
                        if (this.alertSystem) {
                            this.alertSystem.addAlert({
                                level: level, category: 'conflict',
                                message: a.callsign + ' ⇄ ' + b.callsign + ' 冲突(' + dist.toFixed(0) + 'm, Δ' + vsep.toFixed(0) + 'm)',
                                droneId: a.id,
                            });
                        }
                        // 自动高度分离
                        a.status = a.status !== 'returning' ? 'cruising' : a.status;
                        b.status = b.status !== 'returning' ? 'cruising' : b.status;
                        a.currentAlt += 40;
                        b.currentAlt -= 40;
                    }
                } else {
                    // 冲突解除
                    if (this._conflictPairs[pairKey]) {
                        delete this._conflictPairs[pairKey];
                        if (this.alertSystem) this.alertSystem.clearByDrone(a.id, 'conflict');
                    }
                }
            }
        }
    };

    // ============ 通信丢失测试 ============
    AircraftManager.prototype.testCommLoss = function () {
        if (!this.selectedId) { this._debug('请先选择一架飞行器'); return; }
        var ac = this.aircraftList.find(function (a) { return a.id === this.selectedId; }.bind(this));
        if (!ac) return;
        ac.commLoss = true;
        ac.commTimer = 0;
        ac.status = 'hovering';
        if (this.alertSystem) {
            this.alertSystem.addAlert({
                level: 'L3', category: 'comm_loss',
                message: ac.callsign + ' 通信丢失，尝试自动返航',
                droneId: ac.id,
            });
        }
        this._debug('COMM LOSS: ' + ac.callsign);
    };

    AircraftManager.prototype._updateCommLoss = function (ac, dt) {
        if (!ac.commLoss) return;
        ac.commTimer += dt;
        if (ac.commTimer < 8 && ac.status === 'hovering') {
            // 悬停摇摆
            ac.currentAlt += Math.sin(ac.commTimer * 3) * 0.3;
        } else if (ac.commTimer >= 8 && ac.status === 'hovering') {
            // 开始返航
            ac.status = 'returning';
            ac.moving = true;
        }
    };

    // ============ 空域网格 ============
    AircraftManager.prototype.createAirspaceGrid = function (bbox) {
        this.clearGrid();
        if (!bbox) return;
        var rows = 8, cols = 8;
        var dLat = (bbox.north - bbox.south) / rows;
        var dLon = (bbox.east - bbox.west) / cols;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var south = bbox.south + r * dLat, north = south + dLat;
                var west = bbox.west + c * dLon, east = west + dLon;
                var e = this.viewer.entities.add({
                    rectangle: {
                        coordinates: Cesium.Rectangle.fromDegrees(west, south, east, north),
                        material: Cesium.Color.GREEN.withAlpha(0.06),
                        outline: true,
                        outlineColor: Cesium.Color.WHITE.withAlpha(0.15),
                    },
                    show: false,
                });
                e._gridCell = { row: r, col: c, south: south, west: west, north: north, east: east };
                this.gridEntities.push(e);
            }
        }
    };

    AircraftManager.prototype.clearGrid = function () {
        for (var i = 0; i < this.gridEntities.length; i++) {
            this.viewer.entities.remove(this.gridEntities[i]);
        }
        this.gridEntities = [];
    };

    AircraftManager.prototype.updateGrid = function () {
        if (!this.showGrid || this.gridEntities.length === 0) return;
        for (var i = 0; i < this.gridEntities.length; i++) {
            var cell = this.gridEntities[i]._gridCell;
            var occupied = false;
            for (var j = 0; j < this.aircraftList.length; j++) {
                var ac = this.aircraftList[j];
                if (ac.currentLat >= cell.south && ac.currentLat <= cell.north &&
                    ac.currentLng >= cell.west && ac.currentLng <= cell.east) {
                    occupied = true; break;
                }
            }
            this.gridEntities[i].rectangle.material = occupied
                ? Cesium.Color.ORANGE.withAlpha(0.15)
                : Cesium.Color.GREEN.withAlpha(0.06);
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
        if (this.cameraView) this.cameraView.show(ac.id, ac.callsign, ac.currentLat, ac.currentLng, ac.heading);

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
        this._conflictPairs = {};
        this.clearGrid();
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

    // ============ 飞行计划 ============
    AircraftManager.prototype.submitFlightPlan = function (depLng, depLat, arrLng, arrLat) {
        if (this.aircraftList.length >= 8) return '已达飞行器数量上限(8架)';
        // 简单冲突评估
        for (var i = 0; i < this.aircraftList.length; i++) {
            var ac = this.aircraftList[i];
            var d1 = Math.sqrt(Math.pow((depLat - ac.currentLat) * 111000, 2) + Math.pow((depLng - ac.currentLng) * 111000 * Math.cos(depLat * Math.PI / 180), 2));
            var d2 = Math.sqrt(Math.pow((arrLat - ac.currentLat) * 111000, 2) + Math.pow((arrLng - ac.currentLng) * 111000 * Math.cos(arrLat * Math.PI / 180), 2));
            if (d1 < 500 || d2 < 500) return '与 ' + ac.callsign + ' 起终点冲突(' + Math.min(d1, d2).toFixed(0) + 'm)';
        }
        // 生成新飞行器
        var id = 'FP-' + String(this.aircraftList.length + 1).padStart(2, '0');
        var colors = ['#ffcc00', '#cc44ff', '#44ffcc', '#ff66aa'];
        var color = colors[this.aircraftList.length % colors.length];
        var alt = 200;
        var route = [[depLng, depLat, alt], [(depLng + arrLng) / 2, (depLat + arrLat) / 2, alt + 30], [arrLng, arrLat, alt]];
        var ac = {
            id: id, callsign: '计划-' + id, type: 'delivery', typeName: '飞行计划',
            color: color, speed: 18, route: route,
            currentLng: depLng, currentLat: depLat, currentAlt: alt,
            routeIndex: 0, routeProgress: 0, heading: 0,
            battery: 100, moving: true, status: 'cruising', lowBattery: false, trailPoints: [],
        };
        this.aircraft[ac.id] = { config: ac, routeEntity: null };
        this._createEntity(ac);
        this.aircraftList.push(ac);
        this._updatePanel();
        return 'ok:' + id;
    };

    // 从后端 WebSocket 更新飞行器位置
    AircraftManager.prototype.updateFromServer = function (droneStates) {
        for (var i = 0; i < droneStates.length; i++) {
            var s = droneStates[i];
            var entry = this.aircraft[s.id];
            if (!entry) {
                // 新飞行器（来自飞行计划等），动态创建
                var ac = {
                    id: s.id, callsign: s.callsign,
                    type: s.type, typeName: s.typeName, color: s.color, speed: s.speed,
                    route: [], currentLng: s.lng, currentLat: s.lat, currentAlt: s.alt,
                    routeIndex: 0, routeProgress: s.routeProgress || 0, heading: s.heading,
                    battery: s.battery, moving: true, status: s.status || 'cruising',
                    lowBattery: false, trailPoints: [],
                };
                this.aircraft[ac.id] = { config: ac, routeEntity: null };
                this._createEntity(ac);
                this.aircraftList.push(ac);
            }
            if (entry && entry.config) {
                var ac = entry.config;
                ac.currentLng = s.lng; ac.currentLat = s.lat; ac.currentAlt = s.alt;
                ac.heading = s.heading; ac.battery = s.battery;
                ac.status = s.status || 'cruising';
                if (entry.entity) {
                    entry.entity.position = Cesium.Cartesian3.fromDegrees(s.lng, s.lat, s.alt);
                }
            }
        }
        this._updatePanel();
    };

    return AircraftManager;
})();
