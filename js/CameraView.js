/**
 * CameraView v3 - 飞行器摄像头 PIP 弹窗
 * 3×3 瓦片网格，飞行器始终居中，无黑边
 */
var CameraView = (function () {
    'use strict';

    var ZOOM = 16;
    var TILE = 256;

    function CameraView() {
        this.activeAircraft = null;
        this.callsign = '';
        this.isVisible = false;
        this.lastUpdate = 0;
        this.imgs = [];
        this._createDOM();
    }

    CameraView.prototype._createDOM = function () {
        var container = document.createElement('div');
        container.id = 'camera-view';
        container.style.display = 'none';

        // 构建 3×3 瓦片网格
        var gridHTML = '<div id="cv-grid" style="width:' + (TILE*3) + 'px;height:' + (TILE*3) + 'px;position:absolute;">';
        for (var i = 0; i < 9; i++) {
            var col = i % 3, row = Math.floor(i / 3);
            gridHTML += '<img id="cv-tile-' + i + '" style="position:absolute;width:' + TILE + 'px;height:' + TILE + 'px;left:' + (col*TILE) + 'px;top:' + (row*TILE) + 'px;image-rendering:pixelated;" src="">';
        }
        gridHTML += '</div>';

        container.innerHTML =
            '<div class="cv-header">' +
            '<span class="cv-title" id="cv-title">机载摄像头</span>' +
            '<button class="cv-close" id="cv-close">&times;</button>' +
            '</div>' +
            '<div id="cv-img-container" style="width:' + TILE + 'px;height:' + TILE + 'px;overflow:hidden;position:relative;background:#0a0f1a;margin:0 auto;">' +
            gridHTML +
            '<div id="cv-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">' +
            '<div style="position:absolute;top:50%;left:50%;width:30px;height:1px;background:#f44;transform:translate(-50%,0);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;width:1px;height:30px;background:#f44;transform:translate(0,-50%);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;width:8px;height:8px;border:1px solid #f44;border-radius:50%;transform:translate(-50%,-50%);"></div>' +
            '<div style="position:absolute;top:50%;left:50%;color:#fff;font-size:10px;text-shadow:0 0 4px #000;transform:translate(-50%,-28px);white-space:nowrap;" id="cv-label">-</div>' +
            '</div>' +
            '</div>' +
            '<div class="cv-footer"><span class="cv-coord" id="cv-coord">-</span></div>';
        var parent = document.getElementById('right-panels') || document.body;
        parent.appendChild(container);

        // 缓存所有 img 引用
        for (var j = 0; j < 9; j++) {
            this.imgs.push(document.getElementById('cv-tile-' + j));
        }

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
        this._loadTiles(lat, lng);
    };

    CameraView.prototype.hide = function () {
        this.isVisible = false;
        this.activeAircraft = null;
        var container = document.getElementById('camera-view');
        if (container) container.style.display = 'none';
    };

    CameraView.prototype.updatePosition = function (lat, lng) {
        if (!this.isVisible) return;
        var now = Date.now();
        if (now - this.lastUpdate < 200) return;
        this.lastUpdate = now;
        this._loadTiles(lat, lng);
    };

    CameraView.prototype._loadTiles = function (lat, lng) {
        var xy = this._latLonToTileXY(lat, lng, ZOOM);
        var cx = xy[0], cy = xy[1];

        // 飞行器在中心瓦片内的像素偏移
        var n = Math.pow(2, ZOOM);
        var px = (lng + 180) / 360 * n;
        var py = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
        var ox = Math.round((px - cx) * TILE);
        var oy = Math.round((py - cy) * TILE);

        // 3×3 网格：中心瓦片 + 8 个邻居
        // 网格定位：让飞行器位置在容器中心
        var gridEl = document.getElementById('cv-grid');
        if (gridEl) {
            gridEl.style.left = -(TILE + ox - TILE/2) + 'px';
            gridEl.style.top = -(TILE + oy - TILE/2) + 'px';
        }

        // 加载 9 个瓦片
        for (var i = 0; i < 9; i++) {
            var dc = (i % 3) - 1;
            var dr = Math.floor(i / 3) - 1;
            var tx = cx + dc, ty = cy + dr;
            var img = this.imgs[i];
            if (!img) continue;

            (function (imgEl, tileX, tileY) {
                var esriUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + ZOOM + '/' + tileY + '/' + tileX;
                var localUrl = 'http://localhost:8080/imagery/' + ZOOM + '/' + tileX + '/' + tileY + '.png';
                imgEl.onerror = function () {
                    if (this.src === esriUrl) this.src = localUrl;
                };
                imgEl.src = esriUrl;
            })(img, tx, ty);
        }

        var label = document.getElementById('cv-label');
        var coord = document.getElementById('cv-coord');
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
