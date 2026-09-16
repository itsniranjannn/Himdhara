import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

# Ensure backend root is on sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.database import SessionLocal, Base, engine
from app.models import NodeModel, SensorReadingModel, AlertModel
from app.seed_data import seed_river_network
from app.mqtt_client import mqtt_service

async def run_e2e_verification():
    print("=== RUNNING E2E INGESTION & PROPAGATION TEST ===")
    seed_river_network()
    
    db = SessionLocal()
    try:
        # Check nodes are seeded
        node_count = db.query(NodeModel).count()
        print(f"1. Seeded nodes verified: {node_count} stations found.")
        assert node_count >= 6, "Expected at least 6 nodes seeded"

        # Simulate normal reading
        t0 = datetime.now(timezone.utc)
        normal_reading = {
            "node_id": "NODE_LANGTANG_01",
            "water_level_cm": 46.0,
            "rainfall_mm": 2.0,
            "soil_moisture_pct": 36.0,
            "timestamp": t0.isoformat()
        }
        await mqtt_service._process_reading(normal_reading)
        
        node = db.query(NodeModel).filter(NodeModel.node_id == "NODE_LANGTANG_01").first()
        print(f"2. Normal reading processed: Node status = {node.current_risk}")
        assert node.current_risk == "NORMAL"

        # Simulate Flood Cloudburst Spike on Langtang (water surge to 195cm, rain 90mm, soil 92%)
        t1 = t0 + timedelta(seconds=10)
        spike_reading = {
            "node_id": "NODE_LANGTANG_01",
            "water_level_cm": 195.0,
            "rainfall_mm": 90.0,
            "soil_moisture_pct": 92.0,
            "timestamp": t1.isoformat()
        }
        await mqtt_service._process_reading(spike_reading)
        
        # Check node state updated to CRITICAL
        db.expire_all()
        node = db.query(NodeModel).filter(NodeModel.node_id == "NODE_LANGTANG_01").first()
        print(f"3. Flood spike reading processed: Node status = {node.current_risk}")
        assert node.current_risk == "CRITICAL"

        # Check cascaded alerts generated in database
        alerts = (
            db.query(AlertModel)
            .filter(AlertModel.source_node_id == "NODE_LANGTANG_01")
            .order_by(AlertModel.eta_minutes.asc())
            .all()
        )
        print(f"4. Cascaded alerts generated: {len(alerts)} alerts routed downstream:")
        for a in alerts:
            print(f"   -> {a.affected_settlement_name} | ETA: {a.eta_minutes} min | Risk: {a.risk_level} | Pop: {a.population_at_risk:,}")
        
        assert len(alerts) >= 3, "Expected at least 3 downstream settlements alerted"
        assert alerts[0].affected_settlement_id == "SETTLE_DHUNCHE"
        print("\n[PASS] E2E INGESTION & GRAPH CASCADE VERIFICATION PASSED SUCCESSFULLY!")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(run_e2e_verification())
