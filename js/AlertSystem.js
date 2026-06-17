/**
 * AlertSystem - 告警生成与展示
 * 7类告警（冲突/围栏/偏航/电池/通信/天气/系统），4级严重度
 */
var AlertSystem = (function () {
    'use strict';

    var MAX_ALERTS = 50;
    var DISPLAY_COUNT = 15;
    var ALERT_TTL_MS = 30000;    // 告警30秒后自动过期

    var LEVEL_COLORS = {
        'INFO': '#4488ff',
        'L1': '#ffaa00',
        'L2': '#ff6600',
        'L3': '#ff0000',
    };

    var LEVEL_LABELS = {
        'INFO': '信息',
        'L1': '关注',
        'L2': '警告',
        'L3': '严重',
    };

    var CATEGORY_NAMES = {
        'conflict': '冲突',
        'fence': '围栏',
        'deviation': '偏航',
        'battery': '电量',
        'comm_loss': '通信',
        'weather': '天气',
        'system': '系统',
    };

    function AlertSystem() {
        this.alerts = [];
        this.dedupKeys = {};
        this.onAlertCallback = null;
    }

    AlertSystem.prototype.addAlert = function (alert) {
        var key = alert.droneId + '_' + alert.category + '_' + alert.level;
        var now = Date.now();
        if (this.dedupKeys[key] && now - this.dedupKeys[key] < 1000) {
            return;
        }
        this.dedupKeys[key] = now;

        alert.id = 'alert_' + now + '_' + Math.random().toString(36).substr(2, 4);
        alert.time = new Date().toLocaleTimeString();
        alert._ts = now;  // 记录创建时间用于过期清理

        this.alerts.unshift(alert);
        if (this.alerts.length > MAX_ALERTS) {
            this.alerts.length = MAX_ALERTS;
        }

        this._renderAlerts();
        this._updateStat();

        if (this.onAlertCallback) {
            this.onAlertCallback(alert);
        }
    };

    AlertSystem.prototype.getAlertCount = function () {
        var now = Date.now();
        return this.alerts.filter(function (a) { return now - (a._ts || 0) < ALERT_TTL_MS; }).length;
    };

    AlertSystem.prototype.getActiveAlerts = function () {
        return this.alerts.filter(function (a) {
            return a.level === 'L2' || a.level === 'L3';
        }).length;
    };

    AlertSystem.prototype._renderAlerts = function () {
        // 清理过期告警
        var now = Date.now();
        this.alerts = this.alerts.filter(function (a) {
            return now - (a._ts || 0) < ALERT_TTL_MS;
        });

        var panel = document.getElementById('alert-list');
        if (!panel) return;

        var recent = this.alerts.slice(0, DISPLAY_COUNT);
        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var a = recent[i];
            var lvl = a.level || 'INFO';
            html +=
                '<div class="alert-item">' +
                '<span class="alert-badge" style="background:' + (LEVEL_COLORS[lvl] || '#888') + '">' + (LEVEL_LABELS[lvl] || lvl) + '</span>' +
                '<div class="alert-text">' +
                '<span class="alert-msg">' + (a.message || '') + '</span>' +
                '<span class="alert-time">' + a.time + '</span>' +
                '</div>' +
                '</div>';
        }
        panel.innerHTML = html || '<div class="alert-empty">暂无告警</div>';
    };

    AlertSystem.prototype._updateStat = function () {
        var el = document.getElementById('alert-count');
        if (el) {
            var active = this.getActiveAlerts();
            el.textContent = this.alerts.length;
            el.style.color = active > 0 ? '#ff4444' : '#888';
        }
    };

    AlertSystem.prototype.clear = function () {
        this.alerts = [];
        this.dedupKeys = {};
        var panel = document.getElementById('alert-list');
        if (panel) panel.innerHTML = '<div class="alert-empty">暂无告警</div>';
        var el = document.getElementById('alert-count');
        if (el) { el.textContent = '0'; el.style.color = '#888'; }
    };

    return AlertSystem;
})();
