import json
import os
import secrets
from .database import SessionLocal, engine, Base, migrate_schema
from .models import NodeModel, SettlementModel, UserModel
from .auth import hash_password, verify_password
from .config import settings
from .topology import load_basins, merged
from .anomaly_engine import anomaly_engine

def _ensure_operator(db):
    """Keep the operator account in line with .env; never ship a guessable default password."""
    username, password = settings.DEFAULT_OPERATOR_USERNAME, settings.DEFAULT_OPERATOR_PASSWORD
    existing = db.query(UserModel).filter(UserModel.username == username).first()
    if password:
        if not existing:
            db.add(UserModel(username=username, password_hash=hash_password(password), role="operator"))
        elif not verify_password(password, existing.password_hash):
            existing.password_hash = hash_password(password)
    elif not db.query(UserModel).first():
        generated = secrets.token_urlsafe(12)
        db.add(UserModel(username=username, password_hash=hash_password(generated), role="operator"))
        print(f"[!] No DEFAULT_OPERATOR_PASSWORD set. Created operator '{username}' with one-time password: {generated}", flush=True)

def seed_river_network():
    """Initializes tables and seeds sensor nodes from river topology JSON."""
    migrate_schema()
    data = merged(load_basins())

    db = SessionLocal()
    inserted = 0
    updated = 0
    try:
        for n in data["nodes"]:
            node_id = n["node_id"]
            existing = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
            thresholds = n.get("thresholds", {})
            
            if not existing:
                anomaly_engine.set_node_thresholds(node_id, thresholds)
                new_node = NodeModel(
                    node_id=node_id,
                    basin_id=n["basin_id"],
                    name=n["name"],
                    node_type=n.get("type", "SENSOR_STATION"),
                    elevation_m=float(n["elevation_m"]),
                    lat=float(n["lat"]),
                    lng=float(n["lng"]),
                    description=n.get("description", ""),
                    downstream_targets=json.dumps(n.get("downstream_targets", [])),
                    thresholds=json.dumps(thresholds),
                    current_risk="NORMAL"
                )
                db.add(new_node)
                inserted += 1
            else:
                # Keep operator-edited thresholds across restarts.
                persisted = json.loads(existing.thresholds) if existing.thresholds else thresholds
                anomaly_engine.set_node_thresholds(node_id, persisted)
                existing.basin_id = n["basin_id"]
                existing.downstream_targets = json.dumps(n.get("downstream_targets", []))
                updated += 1
        for s in data["settlements"]:
            existing = db.query(SettlementModel).filter(SettlementModel.settlement_id == s["settlement_id"]).first()
            if not existing:
                db.add(SettlementModel(settlement_id=s["settlement_id"], basin_id=s["basin_id"], name=s["name"],
                                       evacuation_zone=s.get("evacuation_zone"), population=s.get("population", 0)))
            else:
                existing.basin_id = s["basin_id"]
        _ensure_operator(db)

        db.commit()
        total = db.query(NodeModel).count()
        print(f"[*] River network sensor nodes seeded successfully ({inserted} inserted, {updated} synchronized, total stations in database: {total}).", flush=True)
    finally:
        db.close()

if __name__ == "__main__":
    seed_river_network()
