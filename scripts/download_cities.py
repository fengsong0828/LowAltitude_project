#!/usr/bin/env python3
"""
批量下载中国8大城市的 OpenStreetMap 建筑数据
北京 · 上海 · 广州 · 深圳 · 重庆 · 成都 · 西安 · 杭州
"""

import json
import urllib.request
import urllib.parse
import sys
import os
import time
import math

# ============ 8城区域配置（扩展至城区级覆盖，约100-250km²）============
CITIES = {
    "beijing": {
        "name": "北京",
        "bbox": {"south": 39.88, "west": 116.30, "north": 39.985, "east": 116.48},
        "center": {"lon": 116.39, "lat": 39.9325, "alt": 5000},
        "desc": "二环至五环主城区",
    },
    "shanghai": {
        "name": "上海",
        "bbox": {"south": 31.18, "west": 121.40, "north": 31.30, "east": 121.55},
        "center": {"lon": 121.475, "lat": 31.24, "alt": 5000},
        "desc": "浦西至浦东主城区",
    },
    "guangzhou": {
        "name": "广州",
        "bbox": {"south": 23.08, "west": 113.23, "north": 23.18, "east": 113.38},
        "center": {"lon": 113.305, "lat": 23.13, "alt": 5000},
        "desc": "天河+海珠+越秀+荔湾",
    },
    "shenzhen": {
        "name": "深圳",
        "bbox": {"south": 22.52, "west": 113.92, "north": 22.58, "east": 114.08},
        "center": {"lon": 114.00, "lat": 22.55, "alt": 4500},
        "desc": "南山+福田+罗湖主城区",
    },
    "chongqing": {
        "name": "重庆",
        "bbox": {"south": 29.52, "west": 106.48, "north": 29.62, "east": 106.65},
        "center": {"lon": 106.565, "lat": 29.57, "alt": 5500},
        "desc": "渝中+江北+南岸+沙坪坝",
    },
    "chengdu": {
        "name": "成都",
        "bbox": {"south": 30.62, "west": 103.98, "north": 30.70, "east": 104.15},
        "center": {"lon": 104.065, "lat": 30.66, "alt": 4500},
        "desc": "主城五区全覆盖",
    },
    "xian": {
        "name": "西安",
        "bbox": {"south": 34.22, "west": 108.88, "north": 34.32, "east": 109.02},
        "center": {"lon": 108.95, "lat": 34.27, "alt": 5000},
        "desc": "碑林+雁塔+未央+新城+莲湖",
    },
    "hangzhou": {
        "name": "杭州",
        "bbox": {"south": 30.22, "west": 120.12, "north": 30.30, "east": 120.25},
        "center": {"lon": 120.185, "lat": 30.26, "alt": 4500},
        "desc": "上城+下城+西湖+拱墅+滨江",
    },
}

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def build_query(bbox):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    area_km2 = (n - s) * 111 * (e - w) * 111 * math.cos(math.radians((s + n) / 2))
    raw = f"""
[out:json][timeout:90];
(
  way["building"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""
    # 按面积估算数据量，调整超时
    timeout = min(120, max(60, int(area_km2 * 3)))
    raw = raw.replace("timeout:90", f"timeout:{timeout}")
    return raw


def fetch_overpass(query):
    for url in OVERPASS_URLS:
        try:
            data = urllib.parse.urlencode({"data": query}).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "LowAltitudePatrol/2.0"})
            with urllib.request.urlopen(req, timeout=150) as resp:
                return json.loads(resp.read().decode("utf-8")), url
        except Exception as e:
            print(f"    端点 {url[:40]}... 失败: {str(e)[:60]}")
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


def process_elements(elements):
    nodes = {}
    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    features = []
    for el in elements:
        if el["type"] != "way":
            continue
        tags = el.get("tags", {})
        if "building" not in tags:
            continue

        nids = el.get("nodes", [])
        if len(nids) < 4:
            continue

        coords = []
        for nid in nids:
            if nid in nodes:
                coords.append([nodes[nid][0], nodes[nid][1]])

        if len(coords) < 4:
            continue
        if coords[0] != coords[-1]:
            coords.append(coords[0])

        h = extract_height(tags)
        if h is None or h < 1.0:
            continue

        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {
                "id": el["id"],
                "height": h,
                "type": tags.get("building", "unknown"),
                "name": tags.get("name", ""),
                "levels": tags.get("building:levels", ""),
                "address": tags.get("addr:street", ""),
            }
        })

    return features


def download_city(city_key, city_info):
    name = city_info["name"]
    bbox = city_info["bbox"]
    print(f"\n{'='*50}")
    print(f"  {name} ({city_key})  —  {city_info['desc']}")
    print(f"  范围: [{bbox['south']}, {bbox['west']}] ~ [{bbox['north']}, {bbox['east']}]")
    print(f"{'='*50}")

    query = build_query(bbox)
    print("  查询 OSM API ...")
    data, src_url = fetch_overpass(query)

    raw_count = sum(1 for e in data["elements"] if e["type"] == "way" and "tags" in e and "building" in e["tags"])
    print(f"  原始建筑: {raw_count}")

    features = process_elements(data["elements"])
    print(f"  有效建筑: {len(features)}")

    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "city": city_key,
            "name": name,
            "center": city_info["center"],
            "bbox": bbox,
            "building_count": len(features),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    }

    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cities")
    os.makedirs(data_dir, exist_ok=True)
    out_path = os.path.join(data_dir, f"{city_key}.geojson")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"  已保存: {out_path} ({size_kb:.0f} KB)")
    return len(features)


def main():
    cities_to_dl = list(CITIES.items())

    # 支持命令行指定部分城市
    if len(sys.argv) > 1:
        cities_to_dl = [(k, CITIES[k]) for k in sys.argv[1:] if k in CITIES]
        if not cities_to_dl:
            print("用法: python download_cities.py [beijing shanghai ...]")
            print(f"可用: {', '.join(CITIES.keys())}")
            return

    print("╔══════════════════════════════════════════════╗")
    print("║  低空巡检系统 - 8城建筑数据批量下载         ║")
    print("╚══════════════════════════════════════════════╝")

    total = 0
    results = {}
    for key, info in cities_to_dl:
        try:
            count = download_city(key, info)
            results[key] = {"count": count, "name": info["name"], "status": "OK"}
            total += count
        except Exception as e:
            print(f"  ✗ 失败: {e}")
            results[key] = {"count": 0, "name": info["name"], "status": "FAIL"}
        time.sleep(3)  # Overpass API 速率限制

    print(f"\n{'='*50}")
    print(f"  下载完成")
    print(f"{'='*50}")
    for key, r in results.items():
        print(f"  {r['name']:>4s} ({key}): {r['count']:>4d} 栋 [{r['status']}]")
    print(f"  {'总计':>8s}: {total:>4d} 栋")
    print(f"\n  数据目录: data/cities/")
    print(f"  启动: start.bat")


if __name__ == "__main__":
    main()
