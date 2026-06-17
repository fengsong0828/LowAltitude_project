/**
 * EngineClient - 后端仿真引擎 WebSocket 客户端
 * 连接 engine_server.py，接收状态推送，驱动前端渲染
 */
var EngineClient = (function () {
    'use strict';

    var WS_URL = 'ws://localhost:8765/ws';
    var API_URL = 'http://localhost:8765';

    function EngineClient(aircraftManager, alertSystem) {
        this.acm = aircraftManager;
        this.alertSystem = alertSystem;
        this.ws = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.useBackend = false;
        this.cityKey = null;
    }

    EngineClient.prototype.connect = function () {
        if (this.ws) return;
        var self = this;
        try {
            this.ws = new WebSocket(WS_URL);
            this.ws.onopen = function () {
                self.connected = true;
                self.useBackend = true;
                console.log('[Engine] WebSocket 已连接');
                if (self.cityKey) self._sendCity();
            };
            this.ws.onmessage = function (evt) {
                var state = JSON.parse(evt.data);
                self._onState(state);
            };
            this.ws.onclose = function () {
                self.connected = false;
                self.useBackend = false;
                console.log('[Engine] WebSocket 断开，切换到前端仿真');
                self.ws = null;
                self.reconnectTimer = setTimeout(function () { self.connect(); }, 3000);
            };
            this.ws.onerror = function () {
                self.connected = false;
                self.useBackend = false;
            };
        } catch (e) {
            console.log('[Engine] WebSocket 连接失败:', e.message);
            this.useBackend = false;
        }
    };

    EngineClient.prototype._sendCity = function () {
        if (!this.ws || !this.cityKey || !this.connected) return;
        this._restCall('POST', '/api/load-city', { city: this.cityKey });
    };

    EngineClient.prototype._restCall = async function (method, path, body) {
        try {
            await fetch(API_URL + path, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (e) {}
    };

    EngineClient.prototype.loadCity = function (cityKey) {
        this.cityKey = cityKey;
        if (this.useBackend) {
            this._sendCity();
            return true; // 使用后端
        }
        return false; // 使用前端仿真
    };

    EngineClient.prototype.submitFlightPlan = function (depLng, depLat, arrLng, arrLat) {
        if (!this.useBackend) return null;
        this._restCall('POST', '/api/flight-plan', { depLng: depLng, depLat: depLat, arrLng: arrLng, arrLat: arrLat });
        return 'submitted';
    };

    EngineClient.prototype.sendCommLoss = function (droneId) {
        if (!this.useBackend) return;
        this._restCall('POST', '/api/comm-loss', { droneId: droneId });
    };

    EngineClient.prototype._onState = function (state) {
        if (!state || !state.drones) return;
        // 更新飞行器位置
        this.acm.updateFromServer(state.drones);
        // 更新告警
        if (this.alertSystem && state.alerts) {
            this.alertSystem.clear();
            for (var i = state.alerts.length - 1; i >= 0; i--) {
                this.alertSystem.addAlert(state.alerts[i]);
            }
        }
    };

    EngineClient.prototype.disconnect = function () {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.useBackend = false;
        this.connected = false;
    };

    return EngineClient;
})();
