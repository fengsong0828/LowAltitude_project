#!/usr/bin/env python3
"""
下载指定区域的 OpenStreetMap 建筑数据
通过 Overpass API 获取建筑轮廓、高度、楼层等信息，输出为 GeoJSON
"""

import json
import urllib.request
import urllib.parse
import sys
import os
import time

# ============ 配置区域 ============
# 默认：清华大学周边 ~3km×2km
DEFAULT_BBOX = {
    "south": 39.99,
    "west": 116.32,
    "north": 40.01,
    "east": 116.35,
}

# Overpass API 端点
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# 中国境内备用：https://overpass.kumi.systems/api/interpreter
OVERPASS_ALT_URL = "https://overpass.kumi.systems/api/interpreter"


def build_query(bbox):
    """构建 Overpass QL 查询，获取建筑数据"""
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    return f"""
[out:json][timeout:60];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""


def fetch_overpass(query, url=OVERPASS_URL):
    """执行 Overpass API 查询"""
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "LowAltitudePatrol/1.0"})
    print(f"  请求 Overpass API: {url}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  主端点失败: {e}")
        if url != OVERPASS_ALT_URL:
            return fetch_overpass(query, OVERPASS_ALT_URL)
        raise


def extract_height_from_tags(tags):
    """从 OSM 标签中提取建筑高度（米）"""
    if not tags:
        return None

    # 直接读取 height 标签
    if "height" in tags:
        try:
            h = float(tags["height"].replace("m", "").strip())
            return h
        except ValueError:
            pass

    # 通过楼层数估算 (每层约3米)
    if "building:levels" in tags:
        try:
            levels = float(tags["building:levels"].split(";")[0].strip())
            return levels * 3.0
        except ValueError:
            pass

    # 建筑类型默认高度
    building_type = tags.get("building", "")
    type_defaults = {
        "house": 6.0,
        "detached": 6.0,
        "residential": 9.0,
        "apartments": 12.0,
        "commercial": 9.0,
        "office": 12.0,
        "industrial": 8.0,
        "warehouse": 8.0,
        "school": 9.0,
        "university": 12.0,
        "hospital": 12.0,
        "hotel": 12.0,
        "garage": 3.0,
        "garages": 3.0,
        "shed": 3.0,
        "roof": 3.0,
        "service": 3.0,
        "kiosk": 3.0,
        "church": 12.0,
        "tower": 30.0,
        "block": 12.0,
        "terrace": 6.0,
        "shop": 6.0,
        "retail": 6.0,
    }
    return type_defaults.get(building_type, 6.0)


def get_building_color(height):
    """根据高度返回建筑颜色"""
    if height is None:
        return "#a0a0a0"
    if height >= 50:
        return "#2c3e50"   # 超高层：深蓝灰
    if height >= 20:
        return "#4a6fa5"   # 中高层：蓝
    if height >= 10:
        return "#6baed6"   # 中层：浅蓝
    return "#c6dbef"       # 低层：极浅蓝


def get_building_type(tags):
    """获取建筑类型"""
    if not tags:
        return "unknown"
    return tags.get("building", "unknown")


def process_elements(elements):
    """将 Overpass 原始数据转换为 GeoJSON FeatureCollection"""
    nodes = {}
    features = []

    # 第一遍：收集所有节点
    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    # 第二遍：处理 way 类型建筑
    for el in elements:
        if el["type"] != "way":
            continue

        tags = el.get("tags", {})
        if "building" not in tags:
            continue

        nodes_list = el.get("nodes", [])
        if len(nodes_list) < 4:
            continue  # 至少需要4个点形成闭合多边形

        coords = []
        for nid in nodes_list:
            if nid in nodes:
                coords.append([nodes[nid][0], nodes[nid][1]])

        if len(coords) < 4:
            continue

        # 闭合多边形
        if coords[0] != coords[-1]:
            coords.append(coords[0])

        height = extract_height_from_tags(tags)
        if height is None or height < 1.0:
            continue  # 跳过无高度建筑

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords]
            },
            "properties": {
                "id": el["id"],
                "height": height,
                "type": get_building_type(tags),
                "name": tags.get("name", ""),
                "levels": tags.get("building:levels", ""),
                "address": tags.get("addr:street", ""),
                "color": get_building_color(height),
                "osm_tags": tags
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }


def main():
    bbox = DEFAULT_BBOX.copy()

    # 从命令行参数读取自定义区域
    if len(sys.argv) >= 5:
        bbox = {
            "south": float(sys.argv[1]),
            "west": float(sys.argv[2]),
            "north": float(sys.argv[3]),
            "east": float(sys.argv[4]),
        }

    print(f"【OSM 建筑数据下载工具】")
    print(f"  区域: 南={bbox['south']}, 西={bbox['west']}, 北={bbox['north']}, 东={bbox['east']}")
    print(f"  面积约: {(bbox['north']-bbox['south'])*111:.2f}km × {(bbox['east']-bbox['west'])*111*0.866:.2f}km")

    # 构建查询
    query = build_query(bbox)
    print("  正在查询 OSM API ...")

    # 执行查询
    data = fetch_overpass(query)
    raw_count = len([e for e in data["elements"] if e["type"] == "way" and "tags" in e and "building" in e["tags"]])
    print(f"  OSM 返回 {raw_count} 个建筑元素")

    # 处理数据
    geojson = process_elements(data["elements"])
    print(f"  处理后有效建筑: {len(geojson['features'])} 栋")

    # 添加元数据
    geojson["metadata"] = {
        "source": "OpenStreetMap",
        "bbox": bbox,
        "building_count": len(geojson["features"]),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "license": "ODbL"
    }

    # 保存文件
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "buildings.geojson")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    file_size = os.path.getsize(output_path) / 1024 / 1024
    print(f"  已保存到: {output_path}")
    print(f"  文件大小: {file_size:.2f} MB")
    print(f"  完成!")


if __name__ == "__main__":
    main()
