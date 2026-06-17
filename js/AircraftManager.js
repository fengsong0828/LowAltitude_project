/**
 * AircraftManager - 飞行器管理与动力学仿真
 * 管理多架飞行器实体、航线插值、状态跟踪
 */
var AircraftManager = (function () {
    'use strict';

    var CONFIG_URL = 'data/aircraft/';

    function AircraftManager(viewer, state, alertSystem, cameraView) {
        this.viewer = viewer;
        this.state = state;
        this.alertSystem = alertSystem;
        this.cameraView = cameraView;
        this.aircraft = {};       // id → { config, entity, state }
        this.aircraftList = [];   // 有序列表
        this.cityKey = null;
        this.isActive = false;
        this.animationFrame = null;
    }

    // ============ 初始化城市飞行器 ============
    AircraftManager.prototype.loadCity = async function (cityKey) {
        this.clear();
        this.cityKey = cityKey;

        try {
            var url = CONFIG_URL + cityKey + '.json';
            var resp = await fetch(url);
            if (!resp.ok) {
                console.log('[Aircraft] 无飞行器配置: ' + cityKey);
                return;
            }
            var config = await resp.json();
            var list = config.aircraft || [];

            for (var i = 0; i < list.length; i++) {
                var ac = list[i];
                var route = ac.route;
                if (route && route.length > 0) {
                    ac.currentLat = route[0][1];
                    ac.currentLng = route[0][0];
                    ac.currentAlt = route[0][2] || 150;
                }
                ac.routeIndex = 0;
                ac.routeProgress = 0;
                ac.heading = 0;
                ac.moving = true;
                ac.lowBattery = false;
                this._createEntity(ac);
                this.aircraft[ac.id] = { config: ac, entity: null };
                this.aircraftList.push(ac);
            }

            this.isActive = true;
            this._startSimulation();
            this._updatePanel();
            console.log('[Aircraft] ' + cityKey + ': ' + list.length + ' 架就绪');

        } catch (e) {
            console.warn('[Aircraft] 加载失败:', e);
        }
    };

    // ============ 创建飞行器实体 ============
    AircraftManager.prototype._createEntity = function (ac) {
        var color = Cesium.Color.fromCssColorString(ac.color || '#ff6600');
        var entity = this.viewer.entities.add({
            id: 'ac_' + ac.id,
            position: Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt),
            ellipsoid: {
                radii: new Cesium.Cartesian3(15, 15, 3),
                material: color.withAlpha(0.85),
                outline: true,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
            },
            label: {
                text: ac.callsign,
                font: '11px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString('#1a1a2e'),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000),
            },
            point: {
                pixelSize: 6,
                color: color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(5000, 200000),
            },
        });
        entity._acData = ac;
        this.aircraft[ac.id].entity = entity;
    };

    // ============ 仿真循环 ============
    AircraftManager.prototype._startSimulation = function () {
        if (this.animationFrame) return;
        var self = this;
        var lastTime = Date.now();

        function tick() {
            if (!self.isActive) return;
            var now = Date.now();
            var dt = Math.min((now - lastTime) / 1000, 0.5);
            lastTime = now;

            self._updateAll(dt);
            self.animationFrame = requestAnimationFrame(tick);
        }

        this.animationFrame = requestAnimationFrame(tick);
    };

    AircraftManager.prototype._updateAll = function (dt) {
        var changed = false;
        for (var i = 0; i < this.aircraftList.length; i++) {
            var ac = this.aircraftList[i];
            if (ac.moving && ac.route && ac.route.length >= 2) {
                this._moveAircraft(ac, dt);
                changed = true;
            }
            this._updateBattery(ac, dt);
        }

        if (changed) {
            this._updatePanel();
        }
    };

    AircraftManager.prototype._moveAircraft = function (ac, dt) {
        var route = ac.route;
        var idx = ac.routeIndex;
        var prog = ac.routeProgress;

        var p0 = route[idx];
        var p1 = route[(idx + 1) % route.length];

        var dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
        var dLat = p1[1] - p0[1];
        var segLen = Math.sqrt(dLon * dLon + dLat * dLat) * 111000;
        var segTime = segLen / (ac.speed || 20);

        if (segTime > 0) {
            prog += dt / segTime;
        } else {
            prog = 1;
        }

        while (prog >= 1) {
            prog -= 1;
            idx = (idx + 1) % route.length;
            p0 = route[idx];
            p1 = route[(idx + 1) % route.length];
            dLon = (p1[0] - p0[0]) * Math.cos((p0[1] + p1[1]) / 2 * Math.PI / 180);
            dLat = p1[1] - p0[1];
            segLen = Math.sqrt(dLon * dLon + dLat * dLat) * 111000;
            segTime = segLen / (ac.speed || 20);
            if (segTime <= 0) { prog = 0; break; }
            prog /= (segLen > 0 ? 1 : 0.001);
        }

        ac.routeIndex = idx % route.length;
        ac.routeProgress = prog;

        p0 = route[ac.routeIndex];
        p1 = route[(ac.routeIndex + 1) % route.length];
        var t = Math.max(0, Math.min(1, prog));
        ac.currentLng = p0[0] + (p1[0] - p0[0]) * t;
        ac.currentLat = p0[1] + (p1[1] - p0[1]) * t;
        ac.currentAlt = (p0[2] || 150) + ((p1[2] || 150) - (p0[2] || 150)) * t;

        var hd = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI;
        if (hd < 0) hd += 360;
        ac.heading = hd;

        // 更新 Cesium 实体位置
        var entity = this.aircraft[ac.id] && this.aircraft[ac.id].entity;
        if (entity) {
            entity.position = Cesium.Cartesian3.fromDegrees(ac.currentLng, ac.currentLat, ac.currentAlt);
        }

        // 更新摄像头弹窗
        if (this.cameraView && this.cameraView.activeAircraft === ac.id) {
            this.cameraView.updatePosition(ac.currentLat, ac.currentLng);
        }
    };

    AircraftManager.prototype._updateBattery = function (ac, dt) {
        // 模拟电池消耗：每秒 0.02%
        ac.battery = Math.max(0, ac.battery - dt * 0.02);

        // 低电量告警
        if (ac.battery < 15 && !ac.lowBattery) {
            ac.lowBattery = true;
            ac.status = 'returning';
            if (this.alertSystem) {
                this.alertSystem.addAlert({
                    level: 'L2',
                    category: 'battery',
                    message: ac.callsign + ' 电量过低(' + ac.battery.toFixed(0) + '%)，自动返航',
                    droneId: ac.id,
                });
            }
        }
        if (ac.battery <= 0) {
            ac.moving = false;
            ac.status = 'emergency';
            if (this.alertSystem) {
                this.alertSystem.addAlert({
                    level: 'L3',
                    category: 'battery',
                    message: ac.callsign + ' 电量耗尽，紧急降落',
                    droneId: ac.id,
                });
            }
        }
    };

    // ============ 飞行器选择 ============
    AircraftManager.prototype.selectAircraft = function (id) {
        var ac = this.aircraftList.find(function (a) { return a.id === id; });
        if (!ac) return;

        this.selectedId = id;
        this._showDetail(ac);
        this._updatePanel(); // 立即刷新高亮

        // 打开摄像头弹窗
        if (this.cameraView) {
            this.cameraView.show(ac.id, ac.callsign, ac.currentLat, ac.currentLng);
        }

        // 高亮选中的飞行器
        if (this._highlightEntity) {
            this._highlightEntity.point.color = Cesium.Color.WHITE;
        }
        var entry = this.aircraft[id];
        if (entry && entry.entity) {
            entry.entity.point.color = Cesium.Color.YELLOW;
            this._highlightEntity = entry.entity;
        }
    };

    // ============ 详情面板 ============
    AircraftManager.prototype._showDetail = function (ac) {
        var panel = document.getElementById('ac-detail');
        if (!panel) return;

        var statusColors = {
            'cruising': '#00cc66', 'returning': '#ff8800',
            'hovering': '#4488ff', 'emergency': '#ff0000',
            'ground': '#888888',
        };
        var statusTexts = {
            'cruising': '巡航中', 'returning': '返航中',
            'hovering': '悬停', 'emergency': '紧急',
            'ground': '地面',
        };

        panel.innerHTML =
            '<div class="ac-detail-header">' +
            '<span class="ac-dot" style="background:' + ac.color + '"></span>' +
            ac.callsign + ' <span style="color:#888;font-size:11px">' + ac.typeName + '</span>' +
            '</div>' +
            '<div class="ac-detail-grid">' +
            '<div><span>状态</span><span style="color:' + (statusColors[ac.status] || '#888') + '">' + (statusTexts[ac.status] || ac.status) + '</span></div>' +
            '<div><span>经度</span><span>' + ac.currentLng.toFixed(6) + '</span></div>' +
            '<div><span>纬度</span><span>' + ac.currentLat.toFixed(6) + '</span></div>' +
            '<div><span>高度</span><span>' + ac.currentAlt.toFixed(0) + ' m</span></div>' +
            '<div><span>速度</span><span>' + ac.speed + ' m/s</span></div>' +
            '<div><span>航向</span><span>' + ac.heading.toFixed(0) + '°</span></div>' +
            '<div><span>电量</span><span style="color:' + (ac.battery < 20 ? '#ff4444' : '#00cc66') + '">' + ac.battery.toFixed(0) + '%</span></div>' +
            '</div>' +
            '<div class="ac-detail-bar"><div class="ac-battery-fill" style="width:' + ac.battery + '%;background:' + (ac.battery < 20 ? '#ff4444' : '#00cc66') + '"></div></div>';
    };

    // ============ 面板更新 ============
    AircraftManager.prototype._updatePanel = function () {
        var panel = document.getElementById('fleet-list');
        if (!panel) return;

        var html = '';
        for (var i = 0; i < this.aircraftList.length; i++) {
            var ac = this.aircraftList[i];
            var selected = this.selectedId === ac.id ? ' fleet-selected' : '';
            var batColor = ac.battery > 50 ? '#00cc66' : ac.battery > 20 ? '#ffaa00' : '#ff4444';
            html +=
                '<div class="fleet-item' + selected + '" data-acid="' + ac.id + '">' +
                '<span class="fleet-dot" style="background:' + ac.color + '"></span>' +
                '<div class="fleet-info">' +
                '<div class="fleet-name">' + ac.callsign + '</div>' +
                '<div class="fleet-type">' + ac.typeName + ' · ' + ac.currentAlt.toFixed(0) + 'm</div>' +
                '</div>' +
                '<div class="fleet-battery">' +
                '<span style="color:' + batColor + '">' + ac.battery.toFixed(0) + '%</span>' +
                '<div class="fleet-bar"><div class="fleet-bar-fill" style="width:' + ac.battery + '%;background:' + batColor + '"></div></div>' +
                '</div>' +
                '</div>';
        }
        panel.innerHTML = html || '<div class="fp-empty">暂无飞行器</div>';

        // 统计
        var online = this.aircraftList.length;
        var alertCount = this.alertSystem ? this.alertSystem.getAlertCount() : 0;
        var statEl = document.getElementById('fleet-stats');
        if (statEl) {
            statEl.textContent = '在线: ' + online + ' | 告警: ' + alertCount;
        }
    };

    // ============ 清除 ============
    AircraftManager.prototype.clear = function () {
        this.isActive = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        for (var id in this.aircraft) {
            if (this.aircraft.hasOwnProperty(id)) {
                var entry = this.aircraft[id];
                if (entry.entity) {
                    this.viewer.entities.remove(entry.entity);
                }
            }
        }
        this.aircraft = {};
        this.aircraftList = [];
        this.selectedId = null;
        this._highlightEntity = null;

        var panel = document.getElementById('fleet-list');
        if (panel) panel.innerHTML = '';
        var detail = document.getElementById('ac-detail');
        if (detail) detail.innerHTML = '<div class="ac-detail-empty">点击飞行器查看详情</div>';

        if (this.cameraView) {
            this.cameraView.hide();
        }
    };

    // ============ 点击事件处理 ============
    AircraftManager.prototype.handleClick = function (entity) {
        if (entity && entity._acData) {
            this.selectAircraft(entity._acData.id);
            return true;
        }
        return false;
    };

    return AircraftManager;
})();
