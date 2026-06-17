#!/usr/bin/env python3
"""
本地地图数据服务器
- 提供静态文件服务（HTML/JS/CSS/数据）
- 提供地形瓦片服务（从 SRTM .hgt 生成 Cesium quantized-mesh 格式）
- 提供飞行路径 API
"""

import http.server
import os
import math
import json
from io import BytesIO

# ============ 配置 ============
PORT = 8080
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGERY_DIR = os.path.join(PROJECT_DIR, "data", "imagery")
NFZ_DIR = os.path.join(PROJECT_DIR, "data", "nfz")
FP_DIR = os.path.join(PROJECT_DIR, "data", "flightplans")

# 尝试导入 terrain 依赖
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from quantized_mesh_encoder import encode as qm_encode
    HAS_QM_ENCODER = True
except ImportError:
    HAS_QM_ENCODER = False

print(f"[Server] NumPy: {'OK' if HAS_NUMPY else '未安装（地形服务不可用）'}")
print(f"[Server] QM Encoder: {'OK' if HAS_QM_ENCODER else '未安装（地形服务不可用）'}")


def read_hgt(lat, lon):
    """读取 SRTM .hgt 文件"""
    lat_prefix = "N" if lat >= 0 else "S"
    lon_prefix = "E" if lon >= 0 else "W"
    tile_name = f"{lat_prefix}{abs(lat):02d}{lon_prefix}{abs(lon):03d}.hgt"

    hgt_path = os.path.join(SRTM_DIR, tile_name)
    if not os.path.exists(hgt_path):
        return None

    # SRTM-1 (1 arc-second) = 3601×3601 样本
    size = os.path.getsize(hgt_path)
    # SRTM-1: 3601x3601 * 2 bytes = 25,934,402 bytes
    # SRTM-3: 1201x1201 * 2 bytes = 2,884,802 bytes
    if size == 25934402:
        samples = 3601
    elif size == 2884802:
        samples = 1201
    else:
        # 尝试自动推断
        samples = int(math.sqrt(size / 2))
        if samples * samples * 2 != size:
            return None

    data = np.fromfile(hgt_path, dtype='>i2').reshape((samples, samples))
    return data


def build_terrain_tile(z, x, y):
    if not HAS_NUMPY or not HAS_QM_ENCODER:
        return None

    n = 2.0 ** z
    lon_left = x / n * 360.0 - 180.0
    lon_right = (x + 1) / n * 360.0 - 180.0
    lat_bottom = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    lat_top = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))

    lat_start = int(math.floor(lat_bottom))
    lat_end = int(math.floor(lat_top))
    lon_start = int(math.floor(lon_left))
    lon_end = int(math.floor(lon_right))

    try:
        tiles_data = {}
        for lat in range(lat_start, lat_end + 1):
            for lon in range(lon_start, lon_end + 1):
                data = read_hgt(lat, lon)
                if data is not None:
                    tiles_data[(lat, lon)] = data

        grid_size = 65
        heights = np.zeros((grid_size, grid_size), dtype=np.float32)

        if tiles_data:
            lat_step = (lat_top - lat_bottom) / (grid_size - 1)
            lon_step = (lon_right - lon_left) / (grid_size - 1)
            for i in range(grid_size):
                lat_sample = lat_bottom + i * lat_step
                for j in range(grid_size):
                    lon_sample = lon_left + j * lon_step
                    lat_tile = int(math.floor(lat_sample))
                    lon_tile = int(math.floor(lon_sample))
                    if (lat_tile, lon_tile) in tiles_data:
                        hgt = tiles_data[(lat_tile, lon_tile)]
                        row = int((lat_sample - lat_tile) * (hgt.shape[0] - 1))
                        col = int((lon_sample - lon_tile) * (hgt.shape[1] - 1))
                        row = max(0, min(hgt.shape[0] - 1, row))
                        col = max(0, min(hgt.shape[1] - 1, col))
                        heights[i, j] = float(hgt[row, col])

        bounds = [lon_left, lat_bottom, lon_right, lat_top]
        positions = np.zeros((grid_size * grid_size, 3), dtype=np.float32)
        lat_step = (lat_top - lat_bottom) / (grid_size - 1)
        lon_step = (lon_right - lon_left) / (grid_size - 1)
        idx = 0
        for i in range(grid_size):
            lat_val = lat_bottom + i * lat_step
            for j in range(grid_size):
                lon_val = lon_left + j * lon_step
                positions[idx, 0] = lon_val
                positions[idx, 1] = lat_val
                positions[idx, 2] = float(heights[i, j])
                idx += 1

        indices = np.zeros(((grid_size - 1) * (grid_size - 1) * 2, 3), dtype=np.int32)
        ti = 0
        for i in range(grid_size - 1):
            for j in range(grid_size - 1):
                a = i * grid_size + j
                b = a + 1
                c = a + grid_size
                d = c + 1
                indices[ti] = [a, c, b]
                indices[ti + 1] = [b, c, d]
                ti += 2

        buf = BytesIO()
        qm_encode(buf, positions, indices, bounds=bounds)
        return buf.getvalue()

    except Exception:
        return None


class MapRequestHandler(http.server.SimpleHTTPRequestHandler):
    """自定义请求处理器"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT_DIR, **kwargs)

    def do_GET(self):
        # 禁飞区数据 API
        if self.path.startswith("/api/nfz/"):
            city = self.path.split("/api/nfz/")[1].split("?")[0]
            path = os.path.join(NFZ_DIR, f"{city}.json")
            if os.path.exists(path):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(os.path.getsize(path)))
                self.end_headers()
                with open(path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                data = json.dumps([]).encode("utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            return

        # 飞行计划数据 API
        if self.path.startswith("/api/flightplans/"):
            city = self.path.split("/api/flightplans/")[1].split("?")[0]
            path = os.path.join(FP_DIR, f"{city}.json")
            if os.path.exists(path):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(os.path.getsize(path)))
                self.end_headers()
                with open(path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                data = json.dumps([]).encode("utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            return
        # 本地图块服务（data/imagery/{z}/{x}/{y}.png）
        if self.path.startswith("/imagery/"):
            img_path = os.path.join(IMAGERY_DIR, self.path[len("/imagery/"):])
            if os.path.exists(img_path) and os.path.isfile(img_path):
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(os.path.getsize(img_path)))
                self.send_header("Cache-Control", "max-age=86400")
                self.end_headers()
                with open(img_path, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                # 本地无此瓦片，返回 404 让 Cesium 降级到备用图源
                self.send_response(404)
                self.end_headers()
                return

        # CesiumTerrainProvider 元数据
        if self.path == "/terrain/layer.json" or self.path == "/terrain/":
            layer = {
                "tilejson": "2.1.0",
                "format": "quantized-mesh-1.0",
                "version": "1.0.0",
                "scheme": "tms",
                "tiles": ["{z}/{x}/{y}.terrain"],
                "bounds": [-180, -90, 180, 90],
                "projection": "EPSG:4326",
                "available": [[{"startX": 0, "startY": 0, "endX": 25, "endY": 25}]],
            }
            body = json.dumps(layer).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path.startswith("/terrain/"):
            try:
                p = [x for x in self.path.split("/") if x]
                if len(p) >= 3:
                    z, x, y = int(p[1]), int(p[2]), int(p[3].split(".")[0])
                    tile = build_terrain_tile(z, x, y)
                    if tile:
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Length", str(len(tile)))
                        self.end_headers()
                        self.wfile.write(tile)
                    else:
                        # 无数据瓦片返回 204，Cesium 使用平坦瓦片
                        self.send_response(204)
                        self.end_headers()
                    return
            except Exception:
                pass

        # 静态文件（包括 data/tiles/ 下的 GeoJSON）
        return super().do_GET()

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else b"{}"

        # 保存禁飞区
        if self.path.startswith("/api/nfz/"):
            city = self.path.split("/api/nfz/")[1]
            os.makedirs(NFZ_DIR, exist_ok=True)
            path = os.path.join(NFZ_DIR, f"{city}.json")
            with open(path, "wb") as f:
                f.write(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return

        # 保存飞行计划
        if self.path.startswith("/api/flightplans/"):
            city = self.path.split("/api/flightplans/")[1]
            os.makedirs(FP_DIR, exist_ok=True)
            path = os.path.join(FP_DIR, f"{city}.json")
            with open(path, "wb") as f:
                f.write(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return

        self.send_response(404)
        self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # 静默模式


def main():
    print(f"╔══════════════════════════════════════╗")
    print(f"║   低空巡检系统 - 本地地图服务器     ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  项目目录: {PROJECT_DIR}")
    print(f"║  服务端口: {PORT}")
    print(f"║  访问地址: http://localhost:{PORT}")
    print(f"╚══════════════════════════════════════╝")

    server = http.server.HTTPServer(("0.0.0.0", PORT), MapRequestHandler)
    print(f"\n  服务器已启动，按 Ctrl+C 停止")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务器已停止")


if __name__ == "__main__":
    main()
