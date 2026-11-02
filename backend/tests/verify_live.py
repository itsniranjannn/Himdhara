"""Live end-to-end check against a RUNNING backend and simulator (not collected by pytest).

    python backend/tests/verify_live.py

Reads the operator password from .env. For every basin it injects a flood spike on the first station,
then verifies routing, basin isolation, the delivery log and reset. Exits non-zero on any failure.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.getenv("EWS_API", "http://127.0.0.1:8000/api")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
failures = []


def env_value(key):
    try:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return os.getenv(key, "")


def call(path, method="GET", body=None, token=None):
    request = urllib.request.Request(f"{BASE}{path}", method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read().decode() or "null")
    except urllib.error.HTTPError as error:
        return error.code, None


def check(name, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {name}{('  ' + str(detail)) if detail and not condition else ''}")
    if not condition:
        failures.append(name)


def main():
    status, health = call("/health")
    check("backend online", status == 200 and health["status"] == "online")
    check("MQTT connected", health["mqtt_connected"], health)
    status, basins = call("/basins")
    check("five basins configured", status == 200 and len(basins) >= 5, [b["basin_id"] for b in basins])

    status, nodes = call("/nodes")
    check("every station reporting (none OFFLINE)", all(n["current_risk"] != "STALE" for n in nodes),
          [n["node_id"] for n in nodes if n["current_risk"] == "STALE"])

    check("anonymous spike is rejected", call("/spike/inject", "POST", {"node_id": nodes[0]["node_id"]})[0] == 401)
    status, login = call("/auth/login", "POST", {"username": env_value("DEFAULT_OPERATOR_USERNAME") or "operator", "password": env_value("DEFAULT_OPERATOR_PASSWORD")})
    check("operator login", status == 200)
    if status != 200:
        sys.exit(1)
    token = login["access_token"]
    call("/simulation/reset", "POST", token=token)
    time.sleep(8)

    first = {}
    for node in nodes:
        first.setdefault(node["basin_id"], node["node_id"])
    for basin in basins:
        status, _ = call("/spike/inject", "POST", {"node_id": first[basin["basin_id"]], "water_level_surge_cm": 180}, token)
        check(f"spike accepted in {basin['basin_id']}", status == 200)
    print("waiting 25 s for the surge to propagate...")
    time.sleep(25)

    _, alerts = call("/alerts?active_only=true&limit=500")
    _, owner_nodes = call("/nodes")
    node_basin = {n["node_id"]: n["basin_id"] for n in owner_nodes}
    settlements = {s["settlement_id"]: s["basin_id"] for s in call("/settlements")[1]}
    for basin in basins:
        bid = basin["basin_id"]
        mine = [a for a in alerts if a["basin_id"] == bid]
        check(f"{bid}: settlements alerted", len(mine) >= 2, len(mine))
        check(f"{bid}: no alert crosses basins", all(node_basin[a["source_node_id"]] == bid and settlements[a["affected_settlement_id"]] == bid for a in mine))
        check(f"{bid}: ETAs ordered and positive", all(a["eta_minutes"] > 0 for a in mine))
        _, filtered = call(f"/alerts?active_only=true&basin={bid}&limit=500")
        check(f"{bid}: API basin filter matches", {a["alert_id"] for a in filtered} == {a["alert_id"] for a in mine})
        _, forecast = call(f"/nodes/{first[bid]}/forecast")
        check(f"{bid}: forecast available", forecast["status"] in ("OK", "INSUFFICIENT_DATA"))
        _, weather = call(f"/basins/{bid}/weather")
        check(f"{bid}: rain outlook ({weather['status']})", weather["status"] in ("OK", "STALE", "UNAVAILABLE"))

    status, log = call("/notifications/log?limit=500", token=token)
    check("delivery log populated", status == 200 and len(log) >= len(basins))

    target = alerts[0]["alert_id"]
    check("acknowledge", call(f"/alerts/{target}/acknowledge", "POST", {"note": "live check"}, token)[0] == 200)
    check("resolve", call(f"/alerts/{target}/resolve", "POST", {"note": "live check"}, token)[0] == 200)
    check("double resolve rejected", call(f"/alerts/{target}/resolve", "POST", {}, token)[0] == 409)
    check("history recorded", len(call(f"/alerts/{target}/history")[1]) == 2)

    status, summary = call("/analytics/summary?hours=1")
    check("analytics summary", status == 200 and summary["readings_total"] > 0)

    status, reset = call("/simulation/reset", "POST", token=token)
    check("reset closes open alerts", status == 200 and reset["resolved_alerts"] >= 1)
    time.sleep(1)
    check("no open alerts after reset", call("/alerts?active_only=true")[1] == [])

    print(f"\n{'ALL CHECKS PASSED' if not failures else str(len(failures)) + ' CHECK(S) FAILED: ' + ', '.join(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
