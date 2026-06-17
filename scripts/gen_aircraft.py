#!/usr/bin/env python3
"""生成8城飞行器配置文件"""

import json
import os
import math

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(PROJECT_DIR, "data", "aircraft")

CITIES_BBOX = {
    "beijing":    {"south": 39.85, "west": 116.25, "north": 40.02, "east": 116.50, "center": [116.39, 39.9325]},
    "shanghai":   {"south": 31.18, "west": 121.38, "north": 31.32, "east": 121.56, "center": [121.475, 31.24]},
    "guangzhou":  {"south": 23.08, "west": 113.22, "north": 23.20, "east": 113.40, "center": [113.305, 23.13]},
    "shenzhen":   {"south": 22.50, "west": 113.88, "north": 22.62, "east": 114.12, "center": [114.00, 22.55]},
    "chongqing":  {"south": 29.52, "west": 106.47, "north": 29.64, "east": 106.68, "center": [106.565, 29.57]},
    "chengdu":    {"south": 30.62, "west": 103.98, "north": 30.72, "east": 104.16, "center": [104.065, 30.66]},
    "xian":       {"south": 34.22, "west": 108.86, "north": 34.34, "east": 109.04, "center": [108.95, 34.27]},
    "hangzhou":   {"south": 30.20, "west": 120.10, "north": 30.35, "east": 120.28, "center": [120.185, 30.26]},
}


def make_route(bbox, pattern, alt_base=150):
    """生成预设航线"""
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    cx, cy = (w + e) / 2, (s + n) / 2
    dx, dy = e - w, n - s

    pts = []
    if pattern == "grid":
        for row in range(4):
            t = row / 3
            lat = s + t * dy
            l0 = w + dx * 0.15 if row % 2 == 0 else e - dx * 0.15
            l1 = e - dx * 0.15 if row % 2 == 0 else w + dx * 0.15
            for p in range(6):
                pts.append([l0 + (l1 - l0) * (p / 5), lat, alt_base + (row % 3) * 20])
    elif pattern == "circle":
        r = max(dx, dy) * 0.4
        for i in range(24):
            a = i / 24 * math.pi * 2
            pts.append([cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, alt_base + math.sin(i * 0.7) * 30])
    elif pattern == "loop":
        r = max(dx, dy) * 0.35
        for i in range(20):
            a = (i / 20) * math.pi * 2
            pts.append([cx + math.cos(a) * r * 0.7, cy + math.sin(a) * r * 1.1, alt_base + math.sin(i * 0.6) * 25])
    elif pattern == "north_south":
        for i in range(12):
            t = i / 11
            pts.append([cx + dx * 0.2 * math.sin(t * math.pi * 2), s + dy * 0.15 + t * dy * 0.7, alt_base + abs(i - 5.5) * 15])
    elif pattern == "east_west":
        for i in range(12):
            t = i / 11
            pts.append([w + dx * 0.15 + t * dx * 0.7, cy + dy * 0.2 * math.sin(t * math.pi * 2), alt_base + abs(i - 5.5) * 15])
    elif pattern == "perimeter":
        corners = [
            [w + dx * 0.12, s + dy * 0.12],
            [e - dx * 0.12, s + dy * 0.15],
            [e - dx * 0.15, n - dy * 0.12],
            [w + dx * 0.15, n - dy * 0.15],
        ]
        segs = 6
        for ci in range(len(corners)):
            c0 = corners[ci]
            c1 = corners[(ci + 1) % len(corners)]
            for j in range(segs):
                t = j / segs
                pts.append([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, alt_base + 20])

    # 确保闭合
    if len(pts) > 1 and pts[0] != pts[-1]:
        pts.append(list(pts[0]))
    return pts


FLEET_CONFIGS = {
    "beijing": [
        {"id": "BJD-001", "callsign": "京东物流-京A", "type": "delivery", "color": "#00cc66",
         "speed": 22, "alt": 160, "route_pattern": "grid"},
        {"id": "BJD-002", "callsign": "京检-02", "type": "patrol", "color": "#ff8800",
         "speed": 18, "alt": 200, "route_pattern": "circle"},
        {"id": "BJD-003", "callsign": "京测-03", "type": "survey", "color": "#4488ff",
         "speed": 15, "alt": 350, "route_pattern": "loop"},
        {"id": "BJD-004", "callsign": "亿航-京001", "type": "evtol", "color": "#ff4444",
         "speed": 55, "alt": 800, "route_pattern": "north_south"},
    ],
    "shanghai": [
        {"id": "SHD-001", "callsign": "顺丰-沪A", "type": "delivery", "color": "#00cc66",
         "speed": 20, "alt": 150, "route_pattern": "grid"},
        {"id": "SHD-002", "callsign": "沪巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 16, "alt": 180, "route_pattern": "perimeter"},
        {"id": "SHD-003", "callsign": "峰飞-沪001", "type": "evtol", "color": "#ff4444",
         "speed": 60, "alt": 900, "route_pattern": "east_west"},
        {"id": "SHD-004", "callsign": "沪测-04", "type": "survey", "color": "#4488ff",
         "speed": 12, "alt": 300, "route_pattern": "loop"},
    ],
    "guangzhou": [
        {"id": "GZD-001", "callsign": "美团-穗A", "type": "delivery", "color": "#00cc66",
         "speed": 18, "alt": 140, "route_pattern": "grid"},
        {"id": "GZD-002", "callsign": "穗巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 14, "alt": 170, "route_pattern": "circle"},
        {"id": "GZD-003", "callsign": "穗急救-03", "type": "emergency", "color": "#ff0000",
         "speed": 45, "alt": 250, "route_pattern": "north_south"},
    ],
    "shenzhen": [
        {"id": "SZD-001", "callsign": "丰翼-深A", "type": "delivery", "color": "#00cc66",
         "speed": 22, "alt": 150, "route_pattern": "grid"},
        {"id": "SZD-002", "callsign": "深巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 16, "alt": 190, "route_pattern": "circle"},
        {"id": "SZD-003", "callsign": "深航拍-03", "type": "survey", "color": "#4488ff",
         "speed": 10, "alt": 280, "route_pattern": "loop"},
        {"id": "SZD-004", "callsign": "亿航-深001", "type": "evtol", "color": "#ff4444",
         "speed": 58, "alt": 850, "route_pattern": "east_west"},
        {"id": "SZD-005", "callsign": "深急救-05", "type": "emergency", "color": "#ff0000",
         "speed": 50, "alt": 220, "route_pattern": "perimeter"},
    ],
    "chongqing": [
        {"id": "CQD-001", "callsign": "重物流-渝A", "type": "delivery", "color": "#00cc66",
         "speed": 20, "alt": 180, "route_pattern": "grid"},
        {"id": "CQD-002", "callsign": "渝巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 15, "alt": 220, "route_pattern": "perimeter"},
        {"id": "CQD-003", "callsign": "渝测-03", "type": "survey", "color": "#4488ff",
         "speed": 12, "alt": 400, "route_pattern": "loop"},
    ],
    "chengdu": [
        {"id": "CDD-001", "callsign": "蓉物流-川A", "type": "delivery", "color": "#00cc66",
         "speed": 18, "alt": 150, "route_pattern": "grid"},
        {"id": "CDD-002", "callsign": "蓉巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 14, "alt": 170, "route_pattern": "circle"},
        {"id": "CDD-003", "callsign": "蓉急救-03", "type": "emergency", "color": "#ff0000",
         "speed": 48, "alt": 240, "route_pattern": "north_south"},
        {"id": "CDD-004", "callsign": "沃飞-蓉001", "type": "evtol", "color": "#ff4444",
         "speed": 52, "alt": 750, "route_pattern": "east_west"},
    ],
    "xian": [
        {"id": "XAD-001", "callsign": "秦物流-陕A", "type": "delivery", "color": "#00cc66",
         "speed": 20, "alt": 160, "route_pattern": "grid"},
        {"id": "XAD-002", "callsign": "陕巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 16, "alt": 210, "route_pattern": "circle"},
        {"id": "XAD-003", "callsign": "陕测-03", "type": "survey", "color": "#4488ff",
         "speed": 10, "alt": 320, "route_pattern": "perimeter"},
    ],
    "hangzhou": [
        {"id": "HZD-001", "callsign": "杭物流-浙A", "type": "delivery", "color": "#00cc66",
         "speed": 20, "alt": 140, "route_pattern": "grid"},
        {"id": "HZD-002", "callsign": "浙巡-02", "type": "patrol", "color": "#ff8800",
         "speed": 15, "alt": 180, "route_pattern": "circle"},
        {"id": "HZD-003", "callsign": "浙测-03", "type": "survey", "color": "#4488ff",
         "speed": 11, "alt": 280, "route_pattern": "loop"},
    ],
}

TYPE_NAMES = {
    "delivery": "物流配送", "patrol": "巡检", "survey": "测绘",
    "evtol": "载人eVTOL", "emergency": "应急救援",
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0

    for city_key, bbox in CITIES_BBOX.items():
        fleet = FLEET_CONFIGS.get(city_key, [])
        aircrafts = []

        for cfg in fleet:
            route = make_route(bbox, cfg["route_pattern"], cfg["alt"])
            aircrafts.append({
                "id": cfg["id"],
                "callsign": cfg["callsign"],
                "type": cfg["type"],
                "typeName": TYPE_NAMES.get(cfg["type"], cfg["type"]),
                "color": cfg["color"],
                "speed": cfg["speed"],
                "route": route,
                "battery": 100,
                "status": "cruising",
            })

        out_path = os.path.join(OUT_DIR, f"{city_key}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"city": city_key, "aircraft": aircrafts}, f, ensure_ascii=False, indent=2)

        print(f"  {city_key}: {len(aircrafts)} 架飞行器 → {out_path}")
        total += len(aircrafts)

    print(f"\n  总计: {total} 架飞行器 (8城)")


if __name__ == "__main__":
    main()
