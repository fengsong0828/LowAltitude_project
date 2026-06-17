#!/usr/bin/env python3
"""生成统一飞行器配置文件 fleet.json —— 每城5架，带航线轨迹"""

import json
import os
import math

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(PROJECT_DIR, "data", "aircraft", "fleet.json")

CITIES = {
    "beijing":    {"south": 39.82, "west": 116.22, "north": 40.05, "east": 116.55},
    "shanghai":   {"south": 31.16, "west": 121.35, "north": 31.35, "east": 121.60},
    "guangzhou":  {"south": 23.05, "west": 113.18, "north": 23.22, "east": 113.44},
    "shenzhen":   {"south": 22.48, "west": 113.85, "north": 22.65, "east": 114.15},
    "chongqing":  {"south": 29.50, "west": 106.45, "north": 29.67, "east": 106.70},
    "chengdu":    {"south": 30.60, "west": 103.95, "north": 30.75, "east": 104.20},
    "xian":       {"south": 34.20, "west": 108.83, "north": 34.37, "east": 109.06},
    "hangzhou":   {"south": 30.18, "west": 120.08, "north": 30.38, "east": 120.32},
}

TYPE_NAMES = {
    "delivery": "物流配送", "patrol": "巡检", "survey": "测绘",
    "evtol": "载人eVTOL", "emergency": "应急救援",
}

FLEET = [
    # type,  color,     speed, alt,   pattern
    ("delivery",  "#00cc66", 22, 160, "grid"),
    ("patrol",    "#ff8800", 16, 220, "circle"),
    ("survey",    "#4488ff", 12, 350, "loop"),
    ("evtol",     "#ff4444", 55, 800, "east_west"),
    ("emergency", "#ff0000", 40, 260, "perimeter"),
]

CALLSIGNS = {
    "beijing":    ["京东物流-京A",  "京巡检-02",  "京测绘-03",  "亿航-京001",  "京急救-05"],
    "shanghai":   ["顺丰-沪A",     "沪巡检-02",  "沪测绘-03",  "峰飞-沪001",  "沪急救-05"],
    "guangzhou":  ["美团-穗A",     "穗巡检-02",  "穗测绘-03",  "亿航-穗001",  "穗急救-05"],
    "shenzhen":   ["丰翼-深A",     "深巡检-02",  "深航拍-03",  "亿航-深001",  "深急救-05"],
    "chongqing":  ["重物流-渝A",   "渝巡检-02",  "渝测绘-03",  "沃飞-渝001",  "渝急救-05"],
    "chengdu":    ["蓉物流-川A",   "蓉巡检-02",  "蓉测绘-03",  "沃飞-川001",  "蓉急救-05"],
    "xian":       ["秦物流-陕A",   "陕巡检-02",  "陕测绘-03",  "亿航-陕001",  "陕急救-05"],
    "hangzhou":   ["杭物流-浙A",   "浙巡检-02",  "浙测绘-03",  "峰飞-浙001",  "浙急救-05"],
}


def make_route(bbox, pattern, alt):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    cx, cy = (w + e) / 2, (s + n) / 2
    dx, dy = e - w, n - s
    pts = []

    if pattern == "grid":
        for row in range(5):
            t = row / 4
            lat = s + dy * 0.1 + t * dy * 0.8
            l0 = w + dx * 0.1 if row % 2 == 0 else e - dx * 0.1
            l1 = e - dx * 0.1 if row % 2 == 0 else w + dx * 0.1
            for p in range(8):
                pts.append([l0 + (l1 - l0) * (p / 7), lat, alt + (row % 3) * 15])
    elif pattern == "circle":
        r = max(dx, dy) * 0.4
        for i in range(30):
            a = i / 30 * math.pi * 2
            pts.append([cx + math.cos(a) * r, cy + math.sin(a) * r * 0.75, alt + math.sin(i * 0.5) * 25])
    elif pattern == "loop":
        r = max(dx, dy) * 0.35
        for i in range(25):
            a = (i / 25) * math.pi * 2
            pts.append([cx + math.cos(a) * r * 0.6, cy + math.sin(a) * r * 0.9, alt + math.sin(i * 0.4) * 20])
    elif pattern == "east_west":
        for i in range(14):
            t = i / 13
            pts.append([w + dx * 0.1 + t * dx * 0.8, cy + dy * 0.25 * math.sin(t * math.pi * 2), alt + 20])
    elif pattern == "perimeter":
        corners = [[w + dx * 0.1, s + dy * 0.1], [e - dx * 0.1, s + dy * 0.12],
                   [e - dx * 0.12, n - dy * 0.1], [w + dx * 0.12, n - dy * 0.12]]
        segs = 8
        for ci in range(len(corners)):
            c0, c1 = corners[ci], corners[(ci + 1) % len(corners)]
            for j in range(segs):
                t = j / segs
                pts.append([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, alt + 20])

    if pts and pts[0] != pts[-1]:
        pts.append(list(pts[0]))
    return pts


def main():
    fleet_data = {}

    for city_key, bbox in CITIES.items():
        city_ac = []
        for idx, (ac_type, color, speed, alt, pattern) in enumerate(FLEET):
            route = make_route(bbox, pattern, alt)
            ac = {
                "id": city_key[:3].upper() + "-" + str(idx + 1).zfill(2),
                "callsign": CALLSIGNS[city_key][idx],
                "type": ac_type,
                "typeName": TYPE_NAMES[ac_type],
                "color": color,
                "speed": speed,
                "route": route,
                "battery": 95 - idx * 5,
                "status": "cruising",
            }
            city_ac.append(ac)
        fleet_data[city_key] = city_ac

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(fleet_data, f, ensure_ascii=False, indent=2)

    for city_key, acs in fleet_data.items():
        print(f"  {city_key}: {len(acs)} 架")
    print(f"\n  总计: {sum(len(v) for v in fleet_data.values())} 架 → {OUT_PATH}")


if __name__ == "__main__":
    main()
