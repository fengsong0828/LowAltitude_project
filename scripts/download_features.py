#!/usr/bin/env python3
"""
下载8城自然要素数据：水体、道路、植被
每个城市一次 Overpass API 查询，按类型自动分拣输出
"""

import json
import urllib.request
import urllib.parse
import os
import time
import math

# ============ 与 download_cities.py 一致（扩展至城区级）============
CITIES = {
    "beijing":    {"name": "北京",   "bbox": {"south": 39.88, "west": 116.30, "north": 39.985, "east": 116.48}},
    "shanghai":   {"name": "上海",   "bbox": {"south": 31.18, "west": 121.40, "north": 31.30, "east": 121.55}},
    "guangzhou":  {"name": "广州",   "bbox": {"south": 23.08, "west": 113.23, "north": 23.18, "east": 113.38}},
    "shenzhen":   {"name": "深圳",   "bbox": {"south": 22.52, "west": 113.92, "north": 22.58, "east": 114.08}},
    "chongqing":  {"name": "重庆",   "bbox": {"south": 29.52, "west": 106.48, "north": 29.62, "east": 106.65}},
    "chengdu":    {"name": "成都",   "bbox": {"south": 30.62, "west": 103.98, "north": 30.70, "east": 104.15}},
    "xian":       {"name": "西安",   "bbox": {"south": 34.22, "west": 108.88, "north": 34.32, "east": 109.02}},
    "hangzhou":   {"name": "杭州",   "bbox": {"south": 30.22, "west": 120.12, "north": 30.30, "east": 120.25}},
}

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def build_query(bbox):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    return f"""
[out:json][timeout:90];
(
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
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "LowAltitudePatrol/2.0"})
            with urllib.request.urlopen(req, timeout=150) as resp:
                return json.loads(resp.read().decode("utf-8")), url
        except Exception as e:
            print(f"    端点 {url[:45]}... 失败: {str(e)[:60]}")
            time.sleep(2)
    raise RuntimeError("所有 Overpass 端点均失败")


def classify_feature(el, nodes):
    """分类 OSM 元素 -> 'water' | 'river_line' | 'road' | 'vegetation' | None"""
    tags = el.get("tags", {})
    if not tags:
        return None

    # 水体 — 面状
    if "natural" in tags and tags["natural"] == "water":
        return "water"
    if "waterway" in tags and tags["waterway"] == "riverbank":
        return "water"

    # 河流 — 线状
    if "waterway" in tags and tags["waterway"] in ("river", "stream", "canal"):
        return "river_line"

    # 道路
    if "highway" in tags and tags["highway"] in (
        "motorway", "trunk", "primary", "secondary", "tertiary", "residential"
    ):
        return "road"

    # 植被
    if "leisure" in tags and tags["leisure"] == "park":
        return "vegetation"
    if "landuse" in tags and tags["landuse"] in ("forest", "grass", "meadow", "recreation_ground"):
        return "vegetation"
    if "natural" in tags and tags["natural"] in ("wood", "scrub", "grassland"):
        return "vegetation"

    return None


def el_to_geojson(el, nodes, feature_type):
    """将 OSM element 转为 GeoJSON Feature"""
    nids = el.get("nodes", [])
    if len(nids) < 2:
        return None

    coords = []
    for nid in nids:
        if nid in nodes:
            coords.append([nodes[nid][0], nodes[nid][1]])

    if len(coords) < 2:
        return None

    tags = el.get("tags", {})

    if feature_type in ("water", "vegetation"):
        # 面状要素需要闭合
        if len(coords) < 4:
            return None
        if coords[0] != coords[-1]:
            coords.append(list(coords[0]))
        return {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {
                "id": el["id"],
                "type": tags.get("waterway", tags.get("natural", tags.get("leisure", tags.get("landuse", "")))),
                "name": tags.get("name", ""),
            }
        }
    elif feature_type == "river_line":
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": el["id"],
                "type": tags.get("waterway", "river"),
                "name": tags.get("name", ""),
            }
        }
    elif feature_type == "road":
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": el["id"],
                "type": tags.get("highway", "road"),
                "name": tags.get("name", ""),
                "lanes": tags.get("lanes", ""),
                "oneway": tags.get("oneway", ""),
            }
        }
    return None


def draw_progress_bar(current, total, bar_len=30):
    pct = current / total if total else 0
    filled = int(bar_len * pct)
    bar = "#" * filled + "-" * (bar_len - filled)
    print(f"\r  [{bar}] {current}/{total}", end="", flush=True)


def download_city(city_key, city_info):
    name = city_info["name"]
    bbox = city_info["bbox"]
    print(f"\n{'='*50}")
    print(f"  {name} ({city_key})  自然要素")
    print(f"{'='*50}")

    query = build_query(bbox)
    print("  查询 OSM API ...")
    data, _ = fetch_overpass(query)

    # 收集节点
    nodes = {}
    for el in data["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    # 分类处理
    categories = {"water": [], "river_line": [], "road": [], "vegetation": []}
    way_count = sum(1 for e in data["elements"] if e["type"] == "way")
    processed = 0

    for el in data["elements"]:
        if el["type"] != "way":
            continue
        processed += 1
        cat = classify_feature(el, nodes)
        if cat:
            feat = el_to_geojson(el, nodes, cat)
            if feat:
                categories[cat].append(feat)

    draw_progress_bar(processed, way_count)
    print()

    # 保存
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cities")
    os.makedirs(data_dir, exist_ok=True)

    results = {}
    cat_names = {
        "water": (categories["water"] + categories["river_line"], "water"),
        "road": (categories["road"], "roads"),
        "vegetation": (categories["vegetation"], "vegetation"),
    }

    for cat_key, (features, filename) in cat_names.items():
        geojson = {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {
                "city": city_key,
                "name": name,
                "feature_type": cat_key,
                "count": len(features),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        }
        out_path = os.path.join(data_dir, f"{city_key}_{filename}.geojson")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)
        size_kb = os.path.getsize(out_path) / 1024
        print(f"  {cat_key:>12s}: {len(features):>4d} 条 → {size_kb:.0f} KB")
        results[cat_key] = len(features)

    return results


def main():
    cities_to_dl = list(CITIES.items())
    if len(sys.argv) > 1:
        cities_to_dl = [(k, CITIES[k]) for k in sys.argv[1:] if k in CITIES]

    print("=" * 55)
    print("  低空巡检 - 自然要素下载（水体 / 道路 / 植被）")
    print("=" * 55)

    totals = {"water": 0, "road": 0, "vegetation": 0}
    for key, info in cities_to_dl:
        try:
            r = download_city(key, info)
            for k in totals:
                totals[k] += r.get(k, 0)
        except Exception as e:
            print(f"  [失败] {info['name']}: {e}")
        time.sleep(3)

    print(f"\n{'='*55}")
    print(f"  下载完成")
    print(f"  水体: {totals['water']}  |  道路: {totals['road']}  |  植被: {totals['vegetation']}")
    print(f"  数据目录: data/cities/")
    print(f"{'='*55}")


if __name__ == "__main__":
    import sys
    main()
