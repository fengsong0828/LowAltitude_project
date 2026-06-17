/**
 * CameraView v2.1 - 飞行器摄像头 PIP 弹窗
 * 直接加载卫星图块（IMG标签），ESRI优先，本地备用
 */
var CameraView = (function () {
    'use strict';

    var ZOOM = 16;

    function CameraView() {
        this.activeAircraft = null;
        this.callsign = '';
        this.isVisible = false;
        this.lastUpdate = 0;
        this._createDOM();
    }

    CameraView.prototype._createDOM = function () {
        var container = document.createElement('div');
        container.id = 'camera-view';
        container.style.display = 'none';
        container.innerHTML =
            '<div class="cv-header">' +
            '<span class="cv-title" id="cv-title">机载摄像头</span>' +
            '<button class="cv-close" id="cv-close">&times;</button>' +
            '</div>' +
            '<div id="cv-img-container" style="width:256px;height:256px;overflow:hidden;position:relative;background:#0a0f1a;margin:0 auto;">' +
            '<img id="cv-tile-img" style="position:absolute;width:256px;height:256px;image-rendering:pixelated;" src="">' +
            '<div id="cv-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">' +
            '<div style="position:absolute;top:50%;left:50%;width:30px;height:1px;background:#f44;transform:translate(-50%,0);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;width:1px;height:30px;background:#f44;transform:translate(0,-50%);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;width:8px;height:8px;border:1px solid #f44;border-radius:50%;transform:translate(-50%,-50%);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;color:#fff;font-size:10px;text-shadow:0 0 4px #000;transform:translate(-50%,-28px);white-space:nowrap;" id="cv-label">-</div>' +
            '</div>' +
            '</div>' +
            '<div class="cv-footer"><span class="cv-coord" id="cv-coord">-</span></div>';
        document.body.appendChild(container);
        var self = this;
        document.getElementById('cv-close').onclick = function () { self.hide(); };
    };

    CameraView.prototype.show = function (aircraftId, callsign, lat, lng) {
        this.activeAircraft = aircraftId;
        this.callsign = callsign;
        this.isVisible = true;
        this.lastUpdate = 0;
        var container = document.getElementById('camera-view');
        if (container) container.style.display = 'block';
        var title = document.getElementById('cv-title');
        if (title) title.textContent = callsign + ' 摄像头';
        this._loadTile(lat, lng);
    };

    CameraView.prototype.hide = function () {
        this.isVisible = false;
        this.activeAircraft = null;
        var container = document.getElementById('camera-view');
        if (container) container.style.display = 'none';
    };

    CameraView.prototype.updatePosition = function (lat, lng) {
        if (!this.isVisible) return;
        // 节流：每2秒刷新
        var now = Date.now();
        if (now - this.lastUpdate < 2000) return;
        this.lastUpdate = now;
        this._loadTile(lat, lng);
    };

    CameraView.prototype._loadTile = function (lat, lng) {
        var xy = this._latLonToTileXY(lat, lng, ZOOM);
        var cx = xy[0], cy = xy[1];

        var n = Math.pow(2, ZOOM);
        var px = (lng + 180) / 360 * n;
        var py = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
        var ox = Math.round((px - cx) * 256);
        var oy = Math.round((py - cy) * 256);

        var img = document.getElementById('cv-tile-img');
        var label = document.getElementById('cv-label');
        var coord = document.getElementById('cv-coord');

        if (img) {
            img.style.left = (128 - ox) + 'px';
            img.style.top = (128 - oy) + 'px';
            img.style.display = '';

            // ESRI 优先（有 zoom 16 图块），本地备用
            var esriUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + ZOOM + '/' + cy + '/' + cx;
            var localUrl = 'http://localhost:8080/imagery/' + ZOOM + '/' + cx + '/' + cy + '.png';

            var self = this;
            img.onload = function () { /* 成功 */ };
            img.onerror = function () {
                // ESRI 失败，尝试本地
                if (this.src === esriUrl) {
                    this.src = localUrl;
                }
                // 本地也失败就不管了
            };
            img.src = esriUrl;
        }
        if (label) label.textContent = this.callsign;
        if (coord) coord.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);
    };

    CameraView.prototype._latLonToTileXY = function (lat, lon, zoom) {
        var n = Math.pow(2, zoom);
        var x = Math.floor((lon + 180) / 360 * n);
        var y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return [x, y];
    };

    return CameraView;
})();
