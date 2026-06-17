#!/usr/bin/env python3
"""
瓦片化城市数据下载器
按空间网格分批查询 Overpass API，下载完整都市圈级数据
建筑 + 道路 + 水体 + 植被 一次查询全部获取

输出结构:
  data/tiles/{city}/
    index.json                      # 网格元信息
    buildings/{col}_{row}.geojson   # 建筑瓦片
    water/{col}_{row}.geojson       # 水体瓦片
    roads/{col}_{row}.geojson       # 道路瓦片
    vegetation/{col}_{row}.geojson  # 植被瓦片
"""

import json
import urllib.request
import urllib.parse
import os
import sys
import time
import math

# ============ 8城扩展范围（约30-40km都市圈）============
CITIES_EXPANDED = {
    "beijing": {
        "name": "北京",
        "bbox": {"south": 39.75, "west": 116.15, "north": 40.10, "east": 116.60},
        "center": {"lon": 116.39, "lat": 39.9325, "alt": 8000},
    },
    "shanghai": {
        "name": "上海",
        "bbox": {"south": 31.10, "west": 121.25, "north": 31.45, "east": 121.65},
        "center": {"lon": 121.475, "lat": 31.24, "alt": 8000},
    },
    "guangzhou": {
        "name": "广州",
        "bbox": {"south": 22.90, "west": 113.00, "north": 23.50, "east": 113.80},
        "center": {"lon": 113.305, "lat": 23.13, "alt": 8000},
    },
    "shenzhen": {
        "name": "深圳",
        "bbox": {"south": 22.30, "west": 113.60, "north": 22.80, "east": 114.50},
        "center": {"lon": 114.00, "lat": 22.55, "alt": 7000},
    },
    "chongqing": {
        "name": "重庆",
        "bbox": {"south": 29.40, "west": 106.40, "north": 29.75, "east": 106.75},
        "center": {"lon": 106.565, "lat": 29.57, "alt": 9000},
    },
    "chengdu": {
        "name": "成都",
        "bbox": {"south": 30.50, "west": 103.90, "north": 30.80, "east": 104.25},
        "center": {"lon": 104.065, "lat": 30.66, "alt": 8000},
    },
    "xian": {
        "name": "西安",
        "bbox": {"south": 34.15, "west": 108.80, "north": 34.40, "east": 109.15},
        "center": {"lon": 108.95, "lat": 34.27, "alt": 8000},
    },
    "hangzhou": {
        "name": "杭州",
        "bbox": {"south": 30.10, "west": 120.05, "north": 30.45, "east": 120.40},
        "center": {"lon": 120.185, "lat": 30.26, "alt": 8000},
    },
}

TILE_SIZE = 0.05  # 约5.5km×5.5km

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_combined_query(s, w, n, e):
    """构建综合查询：建筑 + 水体 + 道路 + 植被"""
    return f"""
[out:json][timeout:90];
(
  way["building"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  way["waterway"="riverbank"]({s},{w},{n},{e});
  way["waterway"~"^(river|stream|canal)$"]({s},{w},{n},{e});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"]({s},{w},{n},{e});
  way["leisure"="park"]({s},{w},{n},{e});
  way["landuse"~"^(forest|grass|meadow|recreation_ground)$"]({s},{w},{n},{e});
  way["natural"~"^(wood|scrub|grassland)$"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""


def fetch_overpass(query):
    for url in OVERPASS_URLS:
        try:
            data = urllib.parse.urlencode({"data": query}).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={
                "User-Agent": "LowAltitudePatrol/3.0",
                "Content-Type": "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            short_msg = str(e)[:80]
            print(f"      端点 {url[:50]}... 失败: {short_msg}")
            time.sleep(2)
    raise RuntimeError("所有 Overpass 端点均失败")


def extract_height(tags):
    if not tags:
        return None
    if "height" in tags:
        try:
            return float(tags["height"].replace("m", "").strip())
        except ValueError:
            pass
    if "building:levels" in tags:
        try:
            return float(tags["building:levels"].split(";")[0].strip()) * 3.0
        except ValueError:
            pass
    defaults = {
        "house": 6, "detached": 6, "residential": 9, "apartments": 15,
        "commercial": 12, "office": 15, "industrial": 8, "warehouse": 8,
        "school": 9, "university": 12, "hospital": 15, "hotel": 18,
        "garage": 3, "garages": 3, "shed": 3, "roof": 3,
        "kiosk": 3, "church": 12, "tower": 30, "block": 12,
        "terrace": 6, "shop": 6, "retail": 6, "supermarket": 9,
        "public": 9, "government": 12, "train_station": 12,
    }
    return defaults.get(tags.get("building", ""), 6.0)


def classify_feature(el):
    tags = el.get("tags", {})
    if not tags:
        return None

    if "building" in tags:
        return "building"
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
        return "water_polygon"
    if tags.get("waterway") in ("river", "stream", "canal"):
        return "water_line"
    if tags.get("highway") in ("motorway", "trunk", "primary", "secondary", "tertiary", "residential"):
        return "road"
    if tags.get("leisure") == "park":
        return "vegetation"
    if tags.get("landuse") in ("forest", "grass", "meadow", "recreation_ground"):
        return "vegetation"
    if tags.get("natural") in ("wood", "scrub", "grassland"):
        return "vegetation"
    return None


def process_tile_data(elements, tile_bbox):
    """将Overpass原始数据分拣为建筑/水体/道路/植被 GeoJSON"""
    nodes = {}
    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    result = {"buildings": [], "water": [], "roads": [], "vegetation": []}

    for el in elements:
        if el["type"] != "way":
            continue
        cat = classify_feature(el)
        if not cat:
            continue

        nids = el.get("nodes", [])
        if len(nids) < 2:
            continue

        coords = []
        for nid in nids:
            if nid in nodes:
                coords.append([nodes[nid][0], nodes[nid][1]])
        if len(coords) < 2:
            continue

        tags = el.get("tags", {})

        if cat == "building":
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(list(coords[0]))
            h = extract_height(tags)
            if h is None or h < 1.0:
                continue
            result["buildings"].append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "id": el["id"], "height": h,
                    "type": tags.get("building", "unknown"),
                    "name": tags.get("name", ""),
                    "levels": tags.get("building:levels", ""),
                    "address": tags.get("addr:street", ""),
                }
            })

        elif cat == "water_polygon":
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(list(coords[0]))
            result["water"].append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "id": el["id"], "type": "water",
                    "name": tags.get("name", ""),
                }
            })

        elif cat == "water_line":
            result["water"].append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "id": el["id"],
                    "type": tags.get("waterway", "river"),
                    "name": tags.get("name", ""),
                }
            })

        elif cat == "road":
            result["roads"].append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "id": el["id"],
                    "type": tags.get("highway", "road"),
                    "name": tags.get("name", ""),
                    "lanes": tags.get("lanes", ""),
                    "oneway": tags.get("oneway", ""),
                }
            })

        elif cat == "vegetation":
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(list(coords[0]))
            result["vegetation"].append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "id": el["id"],
                    "type": tags.get("leisure", tags.get("landuse", tags.get("natural", ""))),
                    "name": tags.get("name", ""),
                }
            })

    return result


def save_tile_file(city_key, layer, col, row, features, timestamp):
    dir_path = os.path.join(PROJECT_DIR, "data", "tiles", city_key, layer)
    os.makedirs(dir_path, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "city": city_key, "layer": layer,
            "col": col, "row": row,
            "count": len(features),
            "timestamp": timestamp,
        }
    }
    filepath = os.path.join(dir_path, f"{col}_{row}.geojson")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    return filepath


def save_index(city_key, city_info, grid_cols, grid_rows, tile_counts):
    b = city_info["bbox"]
    index = {
        "city": city_key,
        "name": city_info["name"],
        "center": city_info["center"],
        "gridOrigin": {"lat": b["south"], "lon": b["west"]},
        "tileSizeLat": TILE_SIZE,
        "tileSizeLon": TILE_SIZE,
        "gridCols": grid_cols,
        "gridRows": grid_rows,
        "bbox": b,
        "availableLayers": ["buildings", "water", "roads", "vegetation"],
        "tileCounts": tile_counts,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    dir_path = os.path.join(PROJECT_DIR, "data", "tiles", city_key)
    os.makedirs(dir_path, exist_ok=True)
    filepath = os.path.join(dir_path, "index.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    return filepath


def tile_exists(city_key, layer, col, row):
    filepath = os.path.join(PROJECT_DIR, "data", "tiles", city_key, layer, f"{col}_{row}.geojson")
    return os.path.exists(filepath)


def download_city(city_key, city_info):
    b = city_info["bbox"]
    name = city_info["name"]

    grid_cols = math.ceil((b["east"] - b["west"]) / TILE_SIZE)
    grid_rows = math.ceil((b["north"] - b["south"]) / TILE_SIZE)
    total_tiles = grid_cols * grid_rows

    print(f"\n{'='*60}")
    print(f"  {name} ({city_key})  瓦片化下载")
    print(f"  范围: [{b['south']:.2f}, {b['west']:.2f}] ~ [{b['north']:.2f}, {b['east']:.2f}]")
    print(f"  网格: {grid_cols}×{grid_rows} = {total_tiles} 瓦片 ({TILE_SIZE}°/格)")
    print(f"{'='*60}")

    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tile_counts = {"buildings": 0, "water": 0, "roads": 0, "vegetation": 0}
    completed = 0
    skipped = 0
    failed = 0

    for row in range(grid_rows):
        for col in range(grid_cols):
            t_s = b["south"] + row * TILE_SIZE
            t_n = min(t_s + TILE_SIZE, b["north"])
            t_w = b["west"] + col * TILE_SIZE
            t_e = min(t_w + TILE_SIZE, b["east"])

            tile_s, tile_w, tile_n, tile_e = round(t_s, 6), round(t_w, 6), round(t_n, 6), round(t_e, 6)

            # 检查是否已下载
            any_exist = any(tile_exists(city_key, layer, col, row)
                          for layer in ["buildings", "water", "roads", "vegetation"])
            if any_exist:
                skipped += 1
                continue

            try:
                print(f"  [{col},{row}] ({tile_s:.2f},{tile_w:.2f})~({tile_n:.2f},{tile_e:.2f}) ...", end=" ", flush=True)
                query = build_combined_query(tile_s, tile_w, tile_n, tile_e)
                data = fetch_overpass(query)
                classified = process_tile_data(data["elements"], (tile_s, tile_w, tile_n, tile_e))

                bb = classified["buildings"]
                wa = classified["water"]
                rd = classified["roads"]
                vg = classified["vegetation"]

                if bb:
                    save_tile_file(city_key, "buildings", col, row, bb, timestamp)
                if wa:
                    save_tile_file(city_key, "water", col, row, wa, timestamp)
                if rd:
                    save_tile_file(city_key, "roads", col, row, rd, timestamp)
                if vg:
                    save_tile_file(city_key, "vegetation", col, row, vg, timestamp)

                tile_counts["buildings"] += len(bb)
                tile_counts["water"] += len(wa)
                tile_counts["roads"] += len(rd)
                tile_counts["vegetation"] += len(vg)

                completed += 1
                pct = (completed + skipped) / total_tiles * 100
                print(f"B:{len(bb)} W:{len(wa)} R:{len(rd)} V:{len(vg)}  [{pct:.0f}%]")

            except Exception as e:
                failed += 1
                print(f"失败: {str(e)[:60]}")

            time.sleep(3)  # Overpass 速率限制

    # 保存索引
    save_index(city_key, city_info, grid_cols, grid_rows, tile_counts)

    print(f"\n  {name} 完成: {completed} 成功, {skipped} 跳过, {failed} 失败")
    print(f"  建筑: {tile_counts['buildings']} 栋")
    print(f"  水体: {tile_counts['water']} 条")
    print(f"  道路: {tile_counts['roads']} 条")
    print(f"  植被: {tile_counts['vegetation']} 条")
    return tile_counts


def clean_empty_tiles(city_key, grid_cols, grid_rows):
    """删除所有图层均为空的瓦片文件"""
    removed = 0
    for row in range(grid_rows):
        for col in range(grid_cols):
            all_empty = True
            for layer in ["buildings", "water", "roads", "vegetation"]:
                fp = os.path.join(PROJECT_DIR, "data", "tiles", city_key, layer, f"{col}_{row}.geojson")
                if os.path.exists(fp):
                    with open(fp, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    if len(d.get("features", [])) > 0:
                        all_empty = False
                        break
            if all_empty:
                for layer in ["buildings", "water", "roads", "vegetation"]:
                    fp = os.path.join(PROJECT_DIR, "data", "tiles", city_key, layer, f"{col}_{row}.geojson")
                    if os.path.exists(fp):
                        os.remove(fp)
                        removed += 1
    return removed


def main():
    cities_to_dl = list(CITIES_EXPANDED.items())
    if len(sys.argv) > 1:
        cities_to_dl = [(k, CITIES_EXPANDED[k]) for k in sys.argv[1:] if k in CITIES_EXPANDED]
        if not cities_to_dl:
            print(f"用法: python tile_downloader.py [{' '.join(CITIES_EXPANDED.keys())}]")
            return

    print("=" * 60)
    print("  低空巡检系统 - 瓦片化城市数据下载器 v3.0")
    print("  网格大小: {}° (约 {:.1f}km)".format(TILE_SIZE, TILE_SIZE * 111))
    print("=" * 60)

    grand_totals = {"buildings": 0, "water": 0, "roads": 0, "vegetation": 0}
    for key, info in cities_to_dl:
        try:
            counts = download_city(key, info)
            for k in grand_totals:
                grand_totals[k] += counts.get(k, 0)

            # 清理空瓦片
            b = info["bbox"]
            gc = math.ceil((b["east"] - b["west"]) / TILE_SIZE)
            gr = math.ceil((b["north"] - b["south"]) / TILE_SIZE)
            removed = clean_empty_tiles(key, gc, gr)
            if removed:
                print(f"  清理空瓦片: {removed} 个")

        except Exception as e:
            print(f"\n  [{key}] 严重错误: {e}")

    print(f"\n{'='*60}")
    print(f"  全部下载完成")
    print(f"  总计建筑: {grand_totals['buildings']}")
    print(f"  总计水体: {grand_totals['water']}")
    print(f"  总计道路: {grand_totals['roads']}")
    print(f"  总计植被: {grand_totals['vegetation']}")
    print(f"  数据目录: data/tiles/")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
