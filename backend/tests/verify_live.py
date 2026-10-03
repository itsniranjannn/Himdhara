import requests
import json

def verify():
    # 1. Check health
    health = requests.get("http://127.0.0.1:8000/api/health").json()
    print("Health:", health)

    # 2. Check nodes
    nodes = requests.get("http://127.0.0.1:8000/api/nodes").json()
    print(f"\nMonitoring Stations ({len(nodes)} total):")
    for n in nodes:
        reading = n.get("latest_reading") or {}
        w = reading.get("water_level_cm", "--")
        print(f"  * {n['node_id']} ({n['name']}): Status = {n['current_risk']} | Water = {w}cm")

    # 3. Check Alerts
    alerts = requests.get("http://127.0.0.1:8000/api/alerts").json()
    print(f"\nCascaded Alerts in Store ({len(alerts)} total):")
    for a in alerts[:8]:
        print(f"  * [ALERT] {a['affected_settlement_name']} | ETA: {a['eta_minutes']} min | Risk: {a['risk_level']} | Pop: {a['population_at_risk']}")

if __name__ == "__main__":
    verify()
