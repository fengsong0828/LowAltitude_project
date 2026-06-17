#!/usr/bin/env python3
"""生成各城市特色飞行器路线——基于真实地理特征"""
import json
import os
import math

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(PROJECT_DIR, "data", "aircraft")

def pt(lng, lat, alt): return [lng, lat, alt]

# ============ 各城市特色路线定义 ============
CITY_ROUTES = {
    "beijing": {
        "bbox": {"south": 39.85, "west": 116.25, "north": 40.05, "east": 116.55},
        "aircraft": [
            {"id": "BJD-01", "callsign": "京配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 22, "route": "beijing_delivery"},
            {"id": "BJD-02", "callsign": "京巡-02", "type": "patrol", "typeName": "城市巡检", "color": "#ff8800",
             "speed": 16, "route": "beijing_patrol"},
            {"id": "BJD-03", "callsign": "京测-03", "type": "survey", "typeName": "测绘勘察", "color": "#4488ff",
             "speed": 12, "route": "beijing_survey"},
            {"id": "BJD-04", "callsign": "京通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 55, "route": "beijing_evtol"},
            {"id": "BJD-05", "callsign": "京急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 45, "route": "beijing_emergency"},
        ]
    },
    "shanghai": {
        "bbox": {"south": 31.16, "west": 121.35, "north": 31.35, "east": 121.60},
        "aircraft": [
            {"id": "SHD-01", "callsign": "沪配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 20, "route": "shanghai_delivery"},
            {"id": "SHD-02", "callsign": "沪巡-02", "type": "patrol", "typeName": "浦江巡检", "color": "#ff8800",
             "speed": 15, "route": "shanghai_patrol"},
            {"id": "SHD-03", "callsign": "沪渡-03", "type": "ferry", "typeName": "跨江摆渡", "color": "#ffaa00",
             "speed": 35, "route": "shanghai_ferry"},
            {"id": "SHD-04", "callsign": "沪通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 60, "route": "shanghai_evtol"},
            {"id": "SHD-05", "callsign": "沪急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 45, "route": "shanghai_emergency"},
        ]
    },
    "guangzhou": {
        "bbox": {"south": 23.05, "west": 113.20, "north": 23.20, "east": 113.45},
        "aircraft": [
            {"id": "GZD-01", "callsign": "穗配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 18, "route": "guangzhou_delivery"},
            {"id": "GZD-02", "callsign": "穗巡-02", "type": "patrol", "typeName": "珠水巡检", "color": "#ff8800",
             "speed": 14, "route": "guangzhou_patrol"},
            {"id": "GZD-03", "callsign": "穗渡-03", "type": "ferry", "typeName": "珠江摆渡", "color": "#ffaa00",
             "speed": 35, "route": "guangzhou_ferry"},
            {"id": "GZD-04", "callsign": "穗通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 55, "route": "guangzhou_evtol"},
            {"id": "GZD-05", "callsign": "穗急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 40, "route": "guangzhou_emergency"},
        ]
    },
    "shenzhen": {
        "bbox": {"south": 22.48, "west": 113.85, "north": 22.65, "east": 114.20},
        "aircraft": [
            {"id": "SZD-01", "callsign": "深配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 22, "route": "shenzhen_delivery"},
            {"id": "SZD-02", "callsign": "深巡-02", "type": "patrol", "typeName": "湾区巡检", "color": "#ff8800",
             "speed": 16, "route": "shenzhen_patrol"},
            {"id": "SZD-03", "callsign": "深跨-03", "type": "ferry", "typeName": "跨海湾通行", "color": "#ffaa00",
             "speed": 40, "route": "shenzhen_ferry"},
            {"id": "SZD-04", "callsign": "深通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 58, "route": "shenzhen_evtol"},
            {"id": "SZD-05", "callsign": "深急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 45, "route": "shenzhen_emergency"},
        ]
    },
    "chongqing": {
        "bbox": {"south": 29.50, "west": 106.47, "north": 29.67, "east": 106.72},
        "aircraft": [
            {"id": "CQD-01", "callsign": "渝配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 20, "route": "chongqing_delivery"},
            {"id": "CQD-02", "callsign": "渝巡-02", "type": "patrol", "typeName": "山城巡检", "color": "#ff8800",
             "speed": 15, "route": "chongqing_patrol"},
            {"id": "CQD-03", "callsign": "渝渡-03", "type": "ferry", "typeName": "两江摆渡", "color": "#ffaa00",
             "speed": 35, "route": "chongqing_ferry"},
            {"id": "CQD-04", "callsign": "渝通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 50, "route": "chongqing_evtol"},
            {"id": "CQD-05", "callsign": "渝急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 40, "route": "chongqing_emergency"},
        ]
    },
    "chengdu": {
        "bbox": {"south": 30.60, "west": 103.95, "north": 30.75, "east": 104.20},
        "aircraft": [
            {"id": "CDD-01", "callsign": "蓉配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 18, "route": "chengdu_delivery"},
            {"id": "CDD-02", "callsign": "蓉巡-02", "type": "patrol", "typeName": "环城巡检", "color": "#ff8800",
             "speed": 14, "route": "chengdu_patrol"},
            {"id": "CDD-03", "callsign": "蓉测-03", "type": "survey", "typeName": "测绘勘察", "color": "#4488ff",
             "speed": 11, "route": "chengdu_survey"},
            {"id": "CDD-04", "callsign": "蓉通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 52, "route": "chengdu_evtol"},
            {"id": "CDD-05", "callsign": "蓉急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 42, "route": "chengdu_emergency"},
        ]
    },
    "xian": {
        "bbox": {"south": 34.20, "west": 108.85, "north": 34.35, "east": 109.06},
        "aircraft": [
            {"id": "XAD-01", "callsign": "陕配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 20, "route": "xian_delivery"},
            {"id": "XAD-02", "callsign": "陕巡-02", "type": "patrol", "typeName": "城墙巡检", "color": "#ff8800",
             "speed": 15, "route": "xian_patrol"},
            {"id": "XAD-03", "callsign": "陕测-03", "type": "survey", "typeName": "遗址勘察", "color": "#4488ff",
             "speed": 10, "route": "xian_survey"},
            {"id": "XAD-04", "callsign": "陕通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 50, "route": "xian_evtol"},
            {"id": "XAD-05", "callsign": "陕急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 42, "route": "xian_emergency"},
        ]
    },
    "hangzhou": {
        "bbox": {"south": 30.18, "west": 120.08, "north": 30.35, "east": 120.30},
        "aircraft": [
            {"id": "HZD-01", "callsign": "浙配-01", "type": "delivery", "typeName": "物流配送", "color": "#00cc66",
             "speed": 20, "route": "hangzhou_delivery"},
            {"id": "HZD-02", "callsign": "浙巡-02", "type": "patrol", "typeName": "西湖巡检", "color": "#ff8800",
             "speed": 14, "route": "hangzhou_patrol"},
            {"id": "HZD-03", "callsign": "浙渡-03", "type": "ferry", "typeName": "钱江摆渡", "color": "#ffaa00",
             "speed": 35, "route": "hangzhou_ferry"},
            {"id": "HZD-04", "callsign": "浙通-04", "type": "evtol", "typeName": "载人通勤", "color": "#ff4444",
             "speed": 52, "route": "hangzhou_evtol"},
            {"id": "HZD-05", "callsign": "浙急-05", "type": "emergency", "typeName": "应急救援", "color": "#ff0000",
             "speed": 40, "route": "hangzhou_emergency"},
        ]
    },
}

# ============ 路线生成函数 ============
def make_grid(bbox, alt, rows=5, cols=6):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    pts = []
    for r in range(rows):
        t = r / (rows - 1) if rows > 1 else 0
        lat = s + t * (n - s)
        l0 = w if r % 2 == 0 else e
        l1 = e if r % 2 == 0 else w
        for c in range(cols):
            frac = c / (cols - 1) if cols > 1 else 0
            pts.append([l0 + (l1 - l0) * frac, lat, alt + (r % 3) * 15])
    if pts and pts[0] != pts[-1]:
        pts.append(list(pts[0]))
    return pts

def make_rect_perimeter(bbox, alt, margin=0.08):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    ms = s + (n - s) * margin
    mw = w + (e - w) * margin
    mn = n - (n - s) * margin
    me = e - (e - w) * margin
    segs = 20
    pts = []
    # 上边 (右→左)
    for i in range(segs):
        pts.append([me - (me - mw) * i / segs, mn, alt + 20])
    # 左边 (上→下)
    for i in range(segs):
        pts.append([mw, mn - (mn - ms) * i / segs, alt + 20])
    # 下边 (左→右)
    for i in range(segs):
        pts.append([mw + (me - mw) * i / segs, ms, alt + 20])
    # 右边 (下→上)
    for i in range(segs):
        pts.append([me, ms + (mn - ms) * i / segs, alt + 20])
    pts.append(list(pts[0]))
    return pts

def make_spiral(bbox, alt, loops=3):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    cx, cy = (w + e) / 2, (s + n) / 2
    rx, ry = (e - w) * 0.4, (n - s) * 0.4
    pts = []
    total = loops * 24
    for i in range(total + 1):
        a = (i / 24) * math.pi * 2
        r_frac = i / total
        r = max(rx, ry) * r_frac * 0.9 + 0.1 * max(rx, ry)
        pts.append([cx + math.cos(a) * r * 0.7, cy + math.sin(a) * r, alt + math.sin(i * 0.3) * 15])
    pts.append(list(pts[0]))
    return pts

def make_corridor(bbox, alt, axis="ew"):
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    pts = []
    if axis == "ew":
        for i in range(12):
            t = i / 11
            pts.append([w + t * (e - w), (s + n) / 2 + (n - s) * 0.3 * math.sin(t * math.pi), alt + 20])
    else:
        for i in range(12):
            t = i / 11
            pts.append([(w + e) / 2 + (e - w) * 0.3 * math.sin(t * math.pi), s + t * (n - s), alt + 20])
    pts.append(list(pts[0]))
    return pts

def make_river_cross(bbox, alt, crossings=4):
    """模拟跨江路线"""
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    mid_lat = (s + n) / 2
    pts = []
    for i in range(crossings * 2 + 1):
        if i % 2 == 0:
            pts.append([w + (e - w) * 0.15, mid_lat, alt + 50])  # 北岸
        else:
            pts.append([w + (e - w) * 0.85, mid_lat + 0.005 * (i % 4), alt + 80])  # 南岸
    pts.append(list(pts[0]))
    return pts

def make_coast_patrol(bbox, alt):
    """沿海湾巡检"""
    s, w, n, e = bbox["south"], bbox["west"], bbox["north"], bbox["east"]
    pts = []
    for i in range(20):
        t = i / 19
        pts.append([w + t * (e - w), s + (n - s) * 0.3 * math.sin(t * math.pi * 2), alt + 15])
    pts.append(list(pts[0]))
    return pts


# ============ 具体路线数据 ============
def build_all_routes():
    routes = {}
    for city_key, city_data in CITY_ROUTES.items():
        b = city_data["bbox"]
        routes[city_key] = []

        for ac in city_data["aircraft"]:
            route_name = ac["route"]
            alt = {"delivery": 160, "patrol": 220, "survey": 350, "evtol": 800, "ferry": 250, "emergency": 280}.get(ac["type"], 200)

            if route_name.endswith("_delivery"):
                r = make_grid(b, alt, 5, 6)
            elif route_name.endswith("_patrol"):
                if city_key in ("shenzhen",):
                    r = make_coast_patrol(b, alt)
                elif city_key in ("guangzhou", "shanghai"):
                    r = make_river_cross(b, alt, 5)
                elif city_key in ("xian",):
                    r = make_rect_perimeter(b, alt, 0.06)
                else:
                    r = make_rect_perimeter(b, alt, 0.08)
            elif route_name.endswith("_survey"):
                r = make_spiral(b, alt)
            elif route_name.endswith("_evtol"):
                axis = "ew" if city_key in ("shanghai", "shenzhen", "beijing") else "ns"
                r = make_corridor(b, alt + 100, axis)
            elif route_name.endswith("_ferry"):
                r = make_river_cross(b, alt, 4)
            elif route_name.endswith("_emergency"):
                r = make_rect_perimeter(b, alt + 40, 0.05)
            else:
                r = make_grid(b, alt, 4, 5)

            ac_out = {
                "id": ac["id"], "callsign": ac["callsign"],
                "type": ac["type"], "typeName": ac["typeName"],
                "color": ac["color"], "speed": ac["speed"],
                "route": r, "battery": 95 - routes[city_key].__len__() * 3,
                "status": "cruising",
            }
            routes[city_key].append(ac_out)

    return routes


def main():
    all_routes = build_all_routes()
    os.makedirs(OUT_DIR, exist_ok=True)
    for city_key, acs in all_routes.items():
        out = {"city": city_key, "aircraft": acs}
        path = os.path.join(OUT_DIR, f"{city_key}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"  {city_key}: {len(acs)} 架 → {path}")
    print(f"\n  总计 {sum(len(v) for v in all_routes.values())} 架")


if __name__ == "__main__":
    main()
