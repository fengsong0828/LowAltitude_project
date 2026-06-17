#!/usr/bin/env python3
"""
低空飞行器仿真引擎 (port 8765)
基于 LAFSS 架构, FastAPI + WebSocket 10Hz 状态推送
"""
import asyncio
import json
import math
import os
import random
import time
from typing import Optional

# 依赖检查
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    print("[Engine] FastAPI 未安装，请运行: pip install fastapi uvicorn[standard] websockets")

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_DIR, "data", "aircraft")

# 8城扩展范围
CITY_BBOX = {
    "beijing":    {"south": 39.82, "west": 116.22, "north": 40.05, "east": 116.55},
    "shanghai":   {"south": 31.16, "west": 121.35, "north": 31.35, "east": 121.60},
    "guangzhou":  {"south": 23.05, "west": 113.18, "north": 23.22, "east": 113.44},
    "shenzhen":   {"south": 22.48, "west": 113.85, "north": 22.65, "east": 114.15},
    "chongqing":  {"south": 29.50, "west": 106.45, "north": 29.67, "east": 106.70},
    "chengdu":    {"south": 30.60, "west": 103.95, "north": 30.75, "east": 104.20},
    "xian":       {"south": 34.20, "west": 108.83, "north": 34.37, "east": 109.06},
    "hangzhou":   {"south": 30.18, "west": 120.08, "north": 30.38, "east": 120.32},
}

# 禁飞区
NO_FLY_ZONES = [
    {"lat": 39.91, "lng": 116.40, "radius": 800, "label": "故宫禁飞区"},
    {"lat": 39.95, "lng": 116.33, "radius": 1200, "label": "中南海禁飞区"},
    {"lat": 39.87, "lng": 116.45, "radius": 1000, "label": "使馆区禁飞区"},
]


def haversine(lat1, lng1, lat2, lng2):
    """计算两点距离(m)"""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def interpolate_route(route, progress):
    """沿航线插值"""
    seg_count = len(route) - 1
    t = progress * seg_count
    idx = min(int(t), seg_count - 1)
    frac = t - idx
    p0, p1 = route[idx], route[min(idx+1, seg_count)]
    return (
        p0[0] + (p1[0]-p0[0]) * frac,
        p0[1] + (p1[1]-p0[1]) * frac,
        p0[2] + (p1[2]-p0[2]) * frac,
    )


def calc_total_distance(route):
    """航线总长度(m)"""
    total = 0
    for i in range(1, len(route)):
        total += haversine(route[i-1][1], route[i-1][0], route[i][1], route[i][0])
    return total


class Aircraft:
    def __init__(self, cfg):
        self.id = cfg["id"]
        self.callsign = cfg["callsign"]
        self.drone_type = cfg["type"]
        self.type_name = cfg.get("typeName", cfg["type"])
        self.color = cfg["color"]
        self.speed = cfg["speed"]
        self.route = cfg["route"]
        self.battery = cfg.get("battery", 100)
        self.status = "cruising"
        self.route_progress = 0.0
        self.lat, self.lng, self.alt = self.route[0][1], self.route[0][0], self.route[0][2]
        self.heading = 0
        self.comm_loss = False
        self.comm_timer = 0
        self.fence_warned = False
        self.fence_breached = False
        self.total_dist = calc_total_distance(self.route)

    def to_dict(self):
        return {
            "id": self.id, "callsign": self.callsign,
            "type": self.drone_type, "typeName": self.type_name,
            "color": self.color, "speed": self.speed,
            "lat": self.lat, "lng": self.lng, "alt": self.alt,
            "heading": self.heading, "battery": self.battery,
            "status": self.status, "routeProgress": self.route_progress,
            "commLoss": self.comm_loss,
        }


class SimulationEngine:
    def __init__(self):
        self.drones = {}
        self.alerts = []
        self.conflict_pairs = set()
        self.fence_warned = {}
        self.stats = {"total": 0, "flying": 0, "alerts_active": 0}
        self.running = False

    def load_city(self, city_key):
        self.drones.clear()
        self.alerts.clear()
        self.conflict_pairs.clear()
        filepath = os.path.join(DATA_DIR, f"{city_key}.json")
        if not os.path.exists(filepath):
            return False
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for ac_cfg in data.get("aircraft", []):
            ac = Aircraft(ac_cfg)
            self.drones[ac.id] = ac
        return True

    def add_alert(self, level, category, message, drone_id):
        a = {
            "id": f"alert_{int(time.time()*1000)}_{random.randint(0,9999)}",
            "time": time.strftime("%H:%M:%S"), "level": level,
            "category": category, "message": message, "droneId": drone_id,
        }
        self.alerts.insert(0, a)
        if len(self.alerts) > 50:
            self.alerts = self.alerts[:50]

    def tick(self, dt=0.1):
        for ac in self.drones.values():
            self._update_position(ac, dt)
            self._update_battery(ac, dt)
            self._update_comm_loss(ac, dt)
            self._check_fence(ac)
        self._detect_conflicts()
        self._update_stats()

    def _update_position(self, ac, dt):
        if ac.status == "ground":
            return
        direction = -1 if ac.status == "returning" else 1
        eff_speed = ac.speed * (0.6 if ac.status == "returning" else 1.0)
        seg_dist = ac.total_dist / max(len(ac.route) - 1, 1)
        progress_step = (eff_speed * dt) / ac.total_dist if ac.total_dist > 0 else 0
        ac.route_progress += direction * progress_step

        if ac.route_progress >= 1:
            ac.route_progress -= 1
        elif ac.route_progress < 0:
            ac.route_progress += 1

        ac.lng, ac.lat, ac.alt = interpolate_route(ac.route, ac.route_progress)

        # heading
        seg_count = len(ac.route) - 1
        t = ac.route_progress * seg_count
        idx = min(int(t), seg_count - 1)
        next_idx = min(idx + 1, seg_count)
        p0, p1 = ac.route[idx], ac.route[next_idx]
        ac.heading = (math.degrees(math.atan2(p1[0]-p0[0], p1[1]-p0[1])) + 360) % 360

    def _update_battery(self, ac, dt):
        if ac.status in ("cruising", "returning"):
            ac.battery = max(0, ac.battery - dt * 0.2)
        if ac.battery < 15 and ac.status == "cruising":
            ac.status = "returning"
            self.add_alert("L2", "battery", f"{ac.callsign} 电量不足({ac.battery:.0f}%)，自动返航", ac.id)
        if ac.battery <= 0 and ac.status not in ("emergency", "ground"):
            ac.status = "emergency"
            self.add_alert("L3", "battery", f"{ac.callsign} 电量耗尽，紧急降落", ac.id)
        if ac.status == "emergency":
            ac.alt = max(0, ac.alt - dt * 5)
            if ac.alt <= 0:
                ac.alt = 0
                ac.status = "ground"

    def _update_comm_loss(self, ac, dt):
        if not ac.comm_loss:
            return
        ac.comm_timer += dt
        if ac.comm_timer < 8:
            ac.status = "hovering"
            ac.alt += math.sin(ac.comm_timer * 3) * 0.3
        elif ac.comm_timer < 40:
            ac.status = "returning"
        else:
            ac.status = "landing"
            ac.alt = max(0, ac.alt - dt * 3)
            if ac.alt <= 0:
                ac.alt = 0
                ac.status = "ground"
                ac.comm_loss = False

    def _check_fence(self, ac):
        for z in NO_FLY_ZONES:
            dist = haversine(ac.lat, ac.lng, z["lat"], z["lng"])
            key = f"{ac.id}_{z['label']}"
            if dist < z["radius"] and key not in self.fence_warned:
                self.fence_warned[key] = time.time()
                self.add_alert("L3", "fence", f"{ac.callsign} 闯入{z['label']}！", ac.id)
                ac.status = "emergency"
            elif dist > z["radius"] * 1.5 and key in self.fence_warned:
                del self.fence_warned[key]

    def _detect_conflicts(self):
        active = [a for a in self.drones.values() if a.status not in ("ground", "emergency")]
        for i in range(len(active)):
            for j in range(i+1, len(active)):
                a, b = active[i], active[j]
                dist = haversine(a.lat, a.lng, b.lat, b.lng)
                vsep = abs(a.alt - b.alt)
                pair = f"{a.id}-{b.id}" if a.id < b.id else f"{b.id}-{a.id}"
                if dist < 200 and vsep < 60:
                    if pair not in self.conflict_pairs:
                        self.conflict_pairs.add(pair)
                        level = "L3" if dist < 50 else "L2" if dist < 100 else "L1"
                        self.add_alert(level, "conflict",
                            f"{a.callsign} ⇄ {b.callsign} 冲突({dist:.0f}m)", a.id)
                        a.alt += 40
                        b.alt -= 40
                elif dist >= 250 and pair in self.conflict_pairs:
                    self.conflict_pairs.discard(pair)

    def _update_stats(self):
        self.stats["total"] = len(self.drones)
        self.stats["flying"] = sum(1 for a in self.drones.values() if a.status not in ("ground",))
        self.stats["alerts_active"] = sum(1 for a in self.alerts if a["level"] in ("L2", "L3"))

    def get_state(self):
        return {
            "timestamp": time.time(),
            "city": getattr(self, "city_key", ""),
            "drones": [ac.to_dict() for ac in self.drones.values()],
            "alerts": self.alerts[:30],
            "stats": self.stats,
        }

    def submit_flight_plan(self, dep_lng, dep_lat, arr_lng, arr_lat):
        # 冲突评估
        for ac in self.drones.values():
            d1 = haversine(dep_lat, dep_lng, ac.lat, ac.lng)
            d2 = haversine(arr_lat, arr_lng, ac.lat, ac.lng)
            if d1 < 500 or d2 < 500:
                return {"ok": False, "reason": f"与 {ac.callsign} 起终点冲突({min(d1,d2):.0f}m)"}
        # 生成新飞行器
        n = len(self.drones) + 1
        ac_id = f"FP-{n:02d}"
        alt = 200
        route = [[dep_lng, dep_lat, alt], [(dep_lng+arr_lng)/2, (dep_lat+arr_lat)/2, alt+30], [arr_lng, arr_lat, alt]]
        cfg = {
            "id": ac_id, "callsign": f"计划-{ac_id}", "type": "delivery", "typeName": "飞行计划",
            "color": ["#ffcc00","#cc44ff","#44ffcc","#ff66aa"][n%4],
            "speed": 18, "route": route, "battery": 100, "status": "cruising",
        }
        ac = Aircraft(cfg)
        self.drones[ac.id] = ac
        return {"ok": True, "id": ac_id}


# ============ FastAPI ============
app = FastAPI(title="低空飞行器仿真引擎")
engine = SimulationEngine()


@app.get("/api/state")
async def get_state():
    return JSONResponse(engine.get_state())


@app.post("/api/load-city")
async def load_city(data: dict):
    city = data.get("city", "")
    ok = engine.load_city(city)
    engine.city_key = city if ok else ""
    return {"ok": ok, "city": city}


@app.post("/api/flight-plan")
async def flight_plan(data: dict):
    result = engine.submit_flight_plan(
        data.get("depLng", 0), data.get("depLat", 0),
        data.get("arrLng", 0), data.get("arrLat", 0),
    )
    return JSONResponse(result)


@app.post("/api/comm-loss")
async def comm_loss(data: dict):
    ac_id = data.get("droneId", "")
    ac = engine.drones.get(ac_id)
    if ac:
        ac.comm_loss = True
        ac.comm_timer = 0
        engine.add_alert("L3", "comm_loss", f"{ac.callsign} 通信丢失！", ac.id)
        return {"ok": True}
    return {"ok": False}


@app.post("/api/set-speed")
async def set_speed(data: dict):
    ac_id = data.get("droneId", "")
    speed = data.get("speed", 20)
    ac = engine.drones.get(ac_id)
    if ac:
        ac.speed = speed
        return {"ok": True}
    return {"ok": False}


@app.post("/api/toggle-pause")
async def toggle_pause():
    engine.running = not engine.running
    return {"running": engine.running}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    # 仿真循环
    async def simulation_loop():
        while True:
            if engine.running and engine.drones:
                engine.tick(0.1)
            await asyncio.sleep(0.1)

    async def push_state():
        while True:
            try:
                if engine.running:
                    await ws.send_json(engine.get_state())
            except Exception:
                break
            await asyncio.sleep(0.1)

    engine.running = True
    try:
        await asyncio.gather(simulation_loop(), push_state())
    except WebSocketDisconnect:
        pass
    finally:
        engine.running = False


def main():
    if not HAS_FASTAPI:
        print("[Engine] 需要安装 FastAPI: pip install fastapi uvicorn[standard]")
        return
    print("=" * 50)
    print("  低空飞行器仿真引擎")
    print(f"  HTTP: http://localhost:8765")
    print(f"  WS:   ws://localhost:8765/ws")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="warning")


if __name__ == "__main__":
    main()
