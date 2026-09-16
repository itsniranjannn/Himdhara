import json
import os
from .database import SessionLocal, engine, Base
from .models import NodeModel
from .anomaly_engine import anomaly_engine

def seed_river_network():
    """Initializes tables and seeds sensor nodes from river topology JSON."""
    Base.metadata.create_all(bind=engine)
    
    topology_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "shared", "river_topology.json")
    )
    if not os.path.exists(topology_path):
        print(f"Topology file not found at {topology_path}")
        return

    with open(topology_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    db = SessionLocal()
    try:
        for n in data.get("nodes", []):
            node_id = n["node_id"]
            existing = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
            thresholds = n.get("thresholds", {})
            
            # Register thresholds with anomaly engine
            anomaly_engine.set_node_thresholds(node_id, thresholds)

            if not existing:
                new_node = NodeModel(
                    node_id=node_id,
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
            else:
                existing.thresholds = json.dumps(thresholds)
                existing.downstream_targets = json.dumps(n.get("downstream_targets", []))
        
        db.commit()
        print("River network sensor nodes seeded successfully.")
    finally:
        db.close()

if __name__ == "__main__":
    seed_river_network()
