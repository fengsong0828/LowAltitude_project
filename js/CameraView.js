/**
 * CameraView - 飞行器摄像头 PIP 弹窗
 * 点击飞行器后弹窗显示正下方高倍卫星图，模拟第一视角实时画面
 */
var CameraView = (function () {
    'use strict';

    var TILE_SIZE = 256;
    var ZOOM_LEVEL = 17;  // 高倍率（约 75m 范围）

    function CameraView() {
        this.activeAircraft = null;
        this.callsign = '';
        this.currentLat = 0;
        this.currentLng = 0;
        this.isVisible = false;
        this.updateTimer = null;

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
            '<canvas id="cv-canvas" width="320" height="240"></canvas>' +
            '<div class="cv-footer">' +
            '<span class="cv-coord" id="cv-coord">-</span>' +
            '</div>';
        document.body.appendChild(container);

        var self = this;
        document.getElementById('cv-close').onclick = function () { self.hide(); };
    };

    CameraView.prototype.show = function (aircraftId, callsign, lat, lng) {
        this.activeAircraft = aircraftId;
        this.callsign = callsign;
        this.isVisible = true;

        var container = document.getElementById('camera-view');
        if (container) container.style.display = 'block';

        var title = document.getElementById('cv-title');
        if (title) title.textContent = callsign + ' 摄像头';

        this.updatePosition(lat, lng);
    };

    CameraView.prototype.hide = function () {
        this.isVisible = false;
        this.activeAircraft = null;
        var container = document.getElementById('camera-view');
        if (container) container.style.display = 'none';
    };

    CameraView.prototype.updatePosition = function (lat, lng) {
        if (!this.isVisible) return;

        this.currentLat = lat;
        this.currentLng = lng;

        var coordEl = document.getElementById('cv-coord');
        if (coordEl) {
            coordEl.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6) + ' (高' + ZOOM_LEVEL + '倍)';
        }

        this._drawTile(lat, lng);
    };

    CameraView.prototype._latLonToTileXY = function (lat, lon, zoom) {
        var n = Math.pow(2, zoom);
        var x = Math.floor((lon + 180) / 360 * n);
        var y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return [x, y];
    };

    CameraView.prototype._drawTile = function (lat, lng) {
        var canvas = document.getElementById('cv-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');

        var zoom = ZOOM_LEVEL;
        var xy = this._latLonToTileXY(lat, lng, zoom);
        var cx = xy[0], cy = xy[1];

        // 先填充背景
        ctx.fillStyle = '#1a2a3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制 3×3 瓦片网格（覆盖当前位置 + 周围）
        var loaded = 0;
        var self = this;

        function drawCrosshair() {
            // 十字准星
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 1.5;
            var midX = canvas.width / 2;
            var midY = canvas.height / 2;
            ctx.beginPath();
            ctx.moveTo(midX - 15, midY);
            ctx.lineTo(midX + 15, midY);
            ctx.moveTo(midX, midY - 15);
            ctx.lineTo(midX, midY + 15);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(midX, midY, 4, 0, Math.PI * 2);
            ctx.stroke();

            // 标签
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(self.callsign + ' 正下方', midX, midY - 20);

            ctx.fillStyle = '#888888';
            ctx.font = '9px monospace';
            ctx.fillText('zoom ' + zoom, midX, midY + 25);
        }

        // 加载中心瓦片
        function loadTile(tx, ty, dx, dy) {
            // 优先本地，回退 ESRI
            var urls = [
                'http://localhost:8080/imagery/' + zoom + '/' + tx + '/' + ty + '.png',
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + zoom + '/' + ty + '/' + tx,
            ];

            function tryUrl(idx) {
                if (idx >= urls.length) return;
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    ctx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
                    loaded++;
                    if (loaded === 1) drawCrosshair();
                };
                img.onerror = function () {
                    tryUrl(idx + 1);
                };
                img.src = urls[idx];
            }

            tryUrl(0);
        }

        // 瓦片偏移：当前位置在中心瓦片中的位置
        var n = Math.pow(2, zoom);
        var preciseX = (lng + 180) / 360 * n;
        var preciseY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
        var offsetX = (preciseX - cx) * TILE_SIZE;
        var offsetY = (preciseY - cy) * TILE_SIZE;

        // 中心瓦片
        loadTile(cx, cy, TILE_SIZE / 2 - offsetX, TILE_SIZE / 2 - offsetY);

        // 上下左右各一块（备用扩展）
        setTimeout(function () {
            loadTile(cx - 1, cy, TILE_SIZE / 2 - offsetX - TILE_SIZE, TILE_SIZE / 2 - offsetY);
            loadTile(cx + 1, cy, TILE_SIZE / 2 - offsetX + TILE_SIZE, TILE_SIZE / 2 - offsetY);
            loadTile(cx, cy - 1, TILE_SIZE / 2 - offsetX, TILE_SIZE / 2 - offsetY - TILE_SIZE);
            loadTile(cx, cy + 1, TILE_SIZE / 2 - offsetX, TILE_SIZE / 2 - offsetY + TILE_SIZE);
        }, 200);
    };

    return CameraView;
})();
