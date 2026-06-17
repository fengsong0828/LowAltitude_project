#!/usr/bin/env python3
"""
将现有 GeoJSON 城市数据切分为瓦片文件
用于快速测试瓦片化加载系统，无需重新下载数据

输入: data/cities/{city}.geojson 等
输出: data/tiles/{city}/buildings/{col}_{row}.geojson 等
"""

import json
import os
import sys
import time
import math

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE_SIZE = 0.05  # 瓦片大小（度）

CITIES = ["beijing", "shanghai", "guangzhou", "shenzhen",
          "chongqing", "chengdu", "xian", "hangzhou"]

CITY_NAMES = {
    "beijing": "北京", "shanghai": "上海", "guangzhou": "广州",
    "shenzhen": "深圳", "chongqing": "重庆", "chengdu": "成都",
    "xian": "西安", "hangzhou": "杭州",
}

CITY_CENTERS = {
    "beijing":    {"lon": 116.39, "lat": 39.9325, "alt": 5000},
    "shanghai":   {"lon": 121.475, "lat": 31.24, "alt": 5000},
    "guangzhou":  {"lon": 113.305, "lat": 23.13, "alt": 5000},
    "shenzhen":   {"lon": 114.00, "lat": 22.55, "alt": 4500},
    "chongqing":  {"lon": 106.565, "lat": 29.57, "alt": 5500},
    "chengdu":    {"lon": 104.065, "lat": 30.66, "alt": 4500},
    "xian":       {"lon": 108.95, "lat": 34.27, "alt": 5000},
    "hangzhou":   {"lon": 120.185, "lat": 30.26, "alt": 4500},
}

LAYER_MAP = {
    "buildings":  "{city}.geojson",
    "water":      "{city}_water.geojson",
    "roads":      "{city}_roads.geojson",
    "vegetation": "{city}_vegetation.geojson",
}


def load_geojson(city_key, layer):
    filename = LAYER_MAP[layer].format(city=city_key)
    filepath = os.path.join(PROJECT_DIR, "data", "cities", filename)
    if not os.path.exists(filepath):
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def get_feature_center(feature):
    """获取要素的近似中心坐标"""
    geom = feature.get("geometry", {})
    coords = None

    if geom["type"] == "Polygon":
        coords = geom["coordinates"][0]
    elif geom["type"] == "LineString":
        coords = geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        coords = geom["coordinates"][0][0]
    else:
        # 取第一个坐标
        c = geom.get("coordinates", [])
        if c:
            coords = c[0] if isinstance(c[0][0], (int, float)) else c[0][0]

    if not coords or len(coords) < 1:
        return None

    lons = [p[0] for p in coords]
    lats = [p[1] for p in coords]
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def compute_grid_bbox(city_key):
    """从所有图层数据计算整体bbox，扩展至TILE_SIZE整数倍"""
    min_lon, min_lat = 180, 90
    max_lon, max_lat = -180, -90

    for layer in LAYER_MAP:
        data = load_geojson(city_key, layer)
        if not data or not data.get("features"):
            continue
        for f in data["features"]:
            center = get_feature_center(f)
            if center:
                min_lon = min(min_lon, center[0])
                min_lat = min(min_lat, center[1])
                max_lon = max(max_lon, center[0])
                max_lat = max(max_lat, center[1])

    if min_lon > max_lon:
        return None

    # 扩展至 TILE_SIZE 整数倍，并留一点边距
    margin = TILE_SIZE * 0.5
    min_lon = math.floor((min_lon - margin) / TILE_SIZE) * TILE_SIZE
    min_lat = math.floor((min_lat - margin) / TILE_SIZE) * TILE_SIZE
    max_lon = math.ceil((max_lon + margin) / TILE_SIZE) * TILE_SIZE
    max_lat = math.ceil((max_lat + margin) / TILE_SIZE) * TILE_SIZE

    return {
        "south": round(min_lat, 6),
        "west": round(min_lon, 6),
        "north": round(max_lat, 6),
        "east": round(max_lon, 6),
    }


def feature_in_tile(feature, tile_s, tile_w, tile_n, tile_e):
    """简单判定：要素中心点是否在瓦片范围内"""
    center = get_feature_center(feature)
    if not center:
        return False
    return tile_w <= center[0] <= tile_e and tile_s <= center[1] <= tile_n


def split_city(city_key):
    print(f"\n{'='*50}")
    print(f"  {CITY_NAMES[city_key]} ({city_key})  切分瓦片")
    print(f"{'='*50}")

    bbox = compute_grid_bbox(city_key)
    if not bbox:
        print(f"  无数据，跳过")
        return

    grid_cols = math.ceil((bbox["east"] - bbox["west"]) / TILE_SIZE)
    grid_rows = math.ceil((bbox["north"] - bbox["south"]) / TILE_SIZE)

    print(f"  数据范围: [{bbox['south']:.2f}, {bbox['west']:.2f}] ~ [{bbox['north']:.2f}, {bbox['east']:.2f}]")
    print(f"  网格: {grid_cols}×{grid_rows} ({TILE_SIZE}°/格)")

    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tile_counts = {"buildings": 0, "water": 0, "roads": 0, "vegetation": 0}

    for layer, filename in LAYER_MAP.items():
        data = load_geojson(city_key, layer)
        if not data:
            continue

        features = data.get("features", [])
        print(f"  加载 {layer}: {len(features)} 条")

        # 初始化瓦片集合
        tiles = {}
        for row in range(grid_rows):
            for col in range(grid_cols):
                tiles[(col, row)] = []

        # 分配要素到瓦片
        for f in features:
            center = get_feature_center(f)
            if not center:
                continue
            col = int((center[0] - bbox["west"]) / TILE_SIZE)
            row = int((center[1] - bbox["south"]) / TILE_SIZE)
            col = max(0, min(grid_cols - 1, col))
            row = max(0, min(grid_rows - 1, row))
            tiles[(col, row)].append(f)

        # 保存瓦片
        saved = 0
        out_dir = os.path.join(PROJECT_DIR, "data", "tiles", city_key, layer)
        os.makedirs(out_dir, exist_ok=True)

        for (col, row), feats in tiles.items():
            if not feats:
                continue
            geojson = {
                "type": "FeatureCollection",
                "features": feats,
                "metadata": {
                    "city": city_key, "layer": layer,
                    "col": col, "row": row,
                    "count": len(feats), "timestamp": timestamp,
                }
            }
            filepath = os.path.join(out_dir, f"{col}_{row}.geojson")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(geojson, f, ensure_ascii=False, indent=2)
            saved += 1

        tile_counts[layer] = sum(len(v) for v in tiles.values())
        print(f"  → {saved} 个瓦片文件 ({tile_counts[layer]} 条)")

    # 保存索引
    index = {
        "city": city_key,
        "name": CITY_NAMES[city_key],
        "center": CITY_CENTERS[city_key],
        "gridOrigin": {"lat": bbox["south"], "lon": bbox["west"]},
        "tileSizeLat": TILE_SIZE,
        "tileSizeLon": TILE_SIZE,
        "gridCols": grid_cols,
        "gridRows": grid_rows,
        "bbox": bbox,
        "availableLayers": ["buildings", "water", "roads", "vegetation"],
        "tileCounts": tile_counts,
        "timestamp": timestamp,
    }
    out_dir = os.path.join(PROJECT_DIR, "data", "tiles", city_key)
    os.makedirs(out_dir, exist_ok=True)
    index_path = os.path.join(out_dir, "index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"  建筑: {tile_counts['buildings']}  水体: {tile_counts['water']}  道路: {tile_counts['roads']}  植被: {tile_counts['vegetation']}")
    print(f"  索引: {index_path}")


def main():
    cities = CITIES
    if len(sys.argv) > 1:
        cities = [c for c in sys.argv[1:] if c in CITIES]

    print("=" * 50)
    print("  低空巡检 - GeoJSON 瓦片切分工具")
    print("=" * 50)

    for city_key in cities:
        try:
            split_city(city_key)
        except Exception as e:
            print(f"  [{city_key}] 错误: {e}")

    print(f"\n  完成。数据目录: data/tiles/")
    print(f"  启动服务: 启动 start.bat")


if __name__ == "__main__":
    main()
