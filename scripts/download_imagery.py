#!/usr/bin/env python3
"""
预下载城市区域地图瓦片到本地
从 ESRI 卫星图源下载，存储后可离线使用

用法:
  python download_imagery.py                      # 全部8城 zoom 10-15
  python download_imagery.py beijing              # 仅北京
  python download_imagery.py beijing 12 14        # 北京 zoom 12-14
"""

import os
import sys
import time
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 8城扩展范围（与 tile_downloader.py 一致）
CITIES = {
    "beijing":    {"name": "北京", "bbox": {"south": 39.75, "west": 116.15, "north": 40.10, "east": 116.60}},
    "shanghai":   {"name": "上海", "bbox": {"south": 31.10, "west": 121.25, "north": 31.45, "east": 121.65}},
    "guangzhou":  {"name": "广州", "bbox": {"south": 22.95, "west": 113.15, "north": 23.30, "east": 113.50}},
    "shenzhen":   {"name": "深圳", "bbox": {"south": 22.45, "west": 113.80, "north": 22.75, "east": 114.20}},
    "chongqing":  {"name": "重庆", "bbox": {"south": 29.40, "west": 106.40, "north": 29.75, "east": 106.75}},
    "chengdu":    {"name": "成都", "bbox": {"south": 30.50, "west": 103.90, "north": 30.80, "east": 104.25}},
    "xian":       {"name": "西安", "bbox": {"south": 34.15, "west": 108.80, "north": 34.40, "east": 109.15}},
    "hangzhou":   {"name": "杭州", "bbox": {"south": 30.10, "west": 120.05, "north": 30.45, "east": 120.40}},
}

# 图源：ESRI 卫星（国内可访问）
TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
# OSM 备用 URL（如 ESRI 不可用）
TILE_URL_ALT = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

MAX_WORKERS = 6        # 并行下载线程数
RETRY_COUNT = 3         # 单瓦片重试次数
REQUEST_TIMEOUT = 15    # 单瓦片超时（秒）


def lat_lon_to_tile(lat, lon, zoom):
    """经纬度 → 瓦片坐标"""
    n = 2.0 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(math.radians(lat)) +
             1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def get_tile_range(bbox, zoom):
    """计算 bbox 在某缩放级别覆盖的瓦片范围"""
    sw_x, sw_y = lat_lon_to_tile(bbox["south"], bbox["west"], zoom)
    ne_x, ne_y = lat_lon_to_tile(bbox["north"], bbox["east"], zoom)

    max_tile = (1 << zoom) - 1  # 2^z - 1
    x_min = max(0, min(sw_x, ne_x))
    x_max = min(max_tile, max(sw_x, ne_x))
    y_min = max(0, min(sw_y, ne_y))
    y_max = min(max_tile, max(sw_y, ne_y))

    return x_min, x_max, y_min, y_max


def estimate_tile_count(bbox, z_min, z_max):
    """估算总瓦片数量"""
    total = 0
    for z in range(z_min, z_max + 1):
        x_min, x_max, y_min, y_max = get_tile_range(bbox, z)
        total += (x_max - x_min + 1) * (y_max - y_min + 1)
    return total


def download_tile(z, x, y, out_dir):
    """下载单个瓦片，返回 (z, x, y, success)"""
    filepath = os.path.join(out_dir, str(z), str(x), f"{y}.png")

    if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
        return (z, x, y, True)  # 已存在，跳过

    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    for attempt in range(RETRY_COUNT):
        try:
            url = TILE_URL.format(z=z, y=y, x=x)
            req = urllib.request.Request(url, headers={
                "User-Agent": "LowAltitudePatrol/3.0",
            })
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                data = resp.read()
                if len(data) < 100:
                    # 可能是空白/错误图片
                    if attempt < RETRY_COUNT - 1:
                        time.sleep(1)
                        continue
                    return (z, x, y, False)

                with open(filepath, "wb") as f:
                    f.write(data)
                return (z, x, y, True)

        except Exception:
            if attempt < RETRY_COUNT - 1:
                time.sleep(1)
            else:
                return (z, x, y, False)

    return (z, x, y, False)


def download_city(city_key, city_info, z_min, z_max):
    name = city_info["name"]
    bbox = city_info["bbox"]
    out_dir = os.path.join(PROJECT_DIR, "data", "imagery")

    est = estimate_tile_count(bbox, z_min, z_max)
    print(f"\n{'='*60}")
    print(f"  {name} ({city_key})  zoom {z_min}-{z_max}")
    print(f"  范围: [{bbox['south']:.2f}, {bbox['west']:.2f}] ~ [{bbox['north']:.2f}, {bbox['east']:.2f}]")
    print(f"  预估瓦片: {est}  线程: {MAX_WORKERS}")
    print(f"{'='*60}")

    tasks = []
    for z in range(z_min, z_max + 1):
        x_min, x_max, y_min, y_max = get_tile_range(bbox, z)
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tasks.append((z, x, y))

    total = len(tasks)
    done = 0
    fail = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(download_tile, z, x, y, out_dir): (z, x, y) for z, x, y in tasks}

        for future in as_completed(futures):
            z, x, y, success = future.result()
            done += 1
            if not success:
                fail += 1

            elapsed = time.time() - start_time
            speed = done / elapsed if elapsed > 0 else 0
            pct = done / total * 100 if total > 0 else 0

            if done % 50 == 0 or done == total:
                print(f"\r  进度: {done}/{total} ({pct:.0f}%)  "
                      f"失败: {fail}  速度: {speed:.0f} 瓦片/秒", end="", flush=True)

    print()
    elapsed = time.time() - start_time
    print(f"  完成: {done - fail} 成功, {fail} 失败  耗时: {elapsed:.0f}s")

    return done - fail, fail


def download_global_overview(z_min=3, z_max=7):
    """下载全球低分辨全景（zoom 3-7，共约 1000 块），确保从太空看也有底图"""
    out_dir = os.path.join(PROJECT_DIR, "data", "imagery")
    print(f"\n{'='*60}")
    print(f"  全球全景瓦片  zoom {z_min}-{z_max}")
    print(f"{'='*60}")

    tasks = []
    for z in range(z_min, z_max + 1):
        n = 1 << z
        for x in range(n):
            for y in range(n):
                # 仅下载有陆地的区域（跳过纯海洋瓦片以节省时间）
                tasks.append((z, x, y))

    total = len(tasks)
    done = 0
    fail = 0
    start_time = time.time()
    print(f"  总瓦片: {total}")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(download_tile, z, x, y, out_dir): (z, x, y) for z, x, y in tasks}

        for future in as_completed(futures):
            z, x, y, success = future.result()
            done += 1
            if not success:
                fail += 1
            if done % 100 == 0 or done == total:
                print(f"\r  进度: {done}/{total} ({done/total*100:.0f}%)  "
                      f"失败: {fail}", end="", flush=True)

    print()
    elapsed = time.time() - start_time
    print(f"  完成: {done - fail} 成功, {fail} 失败  耗时: {elapsed:.0f}s")
    return done - fail, fail


def main():
    args = sys.argv[1:]

    # 解析参数
    if args and args[0] == "global":
        z_min = int(args[1]) if len(args) > 1 else 3
        z_max = int(args[2]) if len(args) > 2 else 7
        download_global_overview(z_min, z_max)
        return

    # 城市下载
    city_keys = list(CITIES.keys())
    z_min_default = 10
    z_max_default = 15

    if args:
        if args[0] in CITIES:
            city_keys = [args[0]]
        elif args[0] == "all":
            city_keys = list(CITIES.keys())
        else:
            print(f"用法: python download_imagery.py [city|all|global] [z_min] [z_max]")
            print(f"城市: {', '.join(CITIES.keys())}, all, global")
            return

        if len(args) >= 3:
            z_min_default = int(args[1])
            z_max_default = int(args[2])
        elif len(args) == 2:
            z_max_default = int(args[1])

    total_ok = 0
    total_fail = 0

    print("=" * 60)
    print("  低空巡检 - 本地地图瓦片下载器")
    print(f"  图源: ESRI World Imagery (卫星图)")
    print(f"  缩放级别: {z_min_default} - {z_max_default}")
    print("=" * 60)

    for key in city_keys:
        ok, fail = download_city(key, CITIES[key], z_min_default, z_max_default)
        total_ok += ok
        total_fail += fail

    if total_fail > 0:
        print(f"\n  注意: {total_fail} 块瓦片下载失败。可重新运行此脚本重试。")

    # 显示总大小
    img_dir = os.path.join(PROJECT_DIR, "data", "imagery")
    if os.path.exists(img_dir):
        total_size = 0
        for root, dirs, files in os.walk(img_dir):
            for f in files:
                total_size += os.path.getsize(os.path.join(root, f))
        print(f"\n  本地图库: {total_size / 1024 / 1024:.1f} MB  ({total_ok} 块)")
        print(f"  路径: {img_dir}")

    print(f"\n  下载完成！重启 start.bat 即可使用本地图源。")


if __name__ == "__main__":
    main()
