import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import paho.mqtt.publish as publish

from .config import settings
from .database import get_db, engine, Base
from .models import NodeModel, SensorReadingModel, AlertModel
from .schemas import (
    NodeStatus, ProcessedReading, SettlementAlert, SpikeInjectionRequest
)
from .seed_data import seed_river_network
from .mqtt_client import mqtt_service
from .dispatcher import dispatcher
from .graph_engine import graph_engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes database, seeds graph network, and starts MQTT worker."""
    print("[*] [Startup] Initializing Flood Warning & Alert Routing Backend...")
    seed_river_network()
    
    # Start MQTT ingestion on current asyncio loop
    loop = asyncio.get_running_loop()
    mqtt_service.start(loop)
    print("[+] [Startup] MQTT Ingestion Service connected and active.")
    
    yield
    
    print("[-] [Shutdown] Stopping MQTT Ingestion Service...")
    mqtt_service.stop()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Distributed IoT Sensor Ingestion, Custom Anomaly Detection & Graph-based Alert Routing API",
    lifespan=lifespan
)

# Enable CORS for React dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket Streaming Endpoint ---
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await dispatcher.connect(websocket)
    try:
        while True:
            # Keep-alive receive
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        dispatcher.disconnect(websocket)
    except Exception:
        dispatcher.disconnect(websocket)

# --- REST Endpoints ---
@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "mqtt_broker": settings.MQTT_BROKER,
        "mqtt_port": settings.MQTT_PORT,
        "active_clients": len(dispatcher.active_connections)
    }

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    """Returns database telemetry counters and metrics."""
    return {
        "total_readings": db.query(SensorReadingModel).count(),
        "total_nodes": db.query(NodeModel).count(),
        "active_alerts": db.query(AlertModel).filter(AlertModel.acknowledged == False).count()
    }

@app.get("/api/network/topology")
def get_topology():
    """Returns the complete river topology graph for visualization."""
    topology_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "shared", "river_topology.json")
    )
    with open(topology_path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.get("/api/nodes", response_model=List[NodeStatus])
def get_nodes(db: Session = Depends(get_db)):
    """Returns all sensor stations with current risk status and latest reading."""
    nodes = db.query(NodeModel).all()
    results = []
    
    for n in nodes:
        latest = (
            db.query(SensorReadingModel)
            .filter(SensorReadingModel.node_id == n.node_id)
            .order_by(SensorReadingModel.timestamp.desc())
            .first()
        )
        latest_dict = None
        if latest:
            latest_dict = {
                "water_level_cm": latest.water_level_cm,
                "rainfall_mm": latest.rainfall_mm,
                "soil_moisture_pct": latest.soil_moisture_pct,
                "ema_water_level": latest.ema_water_level,
                "rate_of_change_cm_min": latest.rate_of_change_cm_min,
                "hsi_score": latest.hsi_score,
                "risk_level": latest.risk_level,
                "timestamp": latest.timestamp.isoformat() if latest.timestamp else None
            }
            
        effective_risk = latest.risk_level if latest else (n.current_risk or "NORMAL")
        results.append(NodeStatus(
            node_id=n.node_id,
            name=n.name,
            node_type=n.node_type,
            elevation_m=n.elevation_m,
            lat=n.lat,
            lng=n.lng,
            description=n.description,
            current_risk=effective_risk,
            latest_reading=latest_dict,
            thresholds=json.loads(n.thresholds) if n.thresholds else {}
        ))
    return results

@app.get("/api/nodes/{node_id}/readings")
def get_node_readings(node_id: str, limit: int = 50, db: Session = Depends(get_db)):
    """Returns recent time-series readings for a given node for charting."""
    readings = (
        db.query(SensorReadingModel)
        .filter(SensorReadingModel.node_id == node_id)
        .order_by(SensorReadingModel.timestamp.desc())
        .limit(limit)
        .all()
    )
    readings.reverse()  # Chronological order for charts
    return readings

@app.get("/api/alerts")
def get_alerts(active_only: bool = False, limit: int = 30, db: Session = Depends(get_db)):
    """Returns recent alert cascades."""
    query = db.query(AlertModel)
    if active_only:
        query = query.filter(AlertModel.acknowledged == False)
    alerts = query.order_by(AlertModel.created_at.desc()).limit(limit).all()
    return alerts

@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, db: Session = Depends(get_db)):
    """Marks an emergency alert as acknowledged."""
    alert = db.query(AlertModel).filter(AlertModel.alert_id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    db.commit()
    return {"status": "acknowledged", "alert_id": alert_id}

@app.post("/api/spike/inject")
def inject_spike(request: SpikeInjectionRequest):
    """
    Triggers an emergency flood surge on a specified node for viva presentation.
    Publishes an MQTT control message picked up by the sensor simulator.
    """
    payload = {
        "action": "INJECT_SPIKE",
        "node_id": request.node_id,
        "water_level_surge_cm": request.water_level_surge_cm,
        "rainfall_surge_mm": request.rainfall_surge_mm,
        "soil_moisture_surge_pct": request.soil_moisture_surge_pct,
        "duration_seconds": request.duration_seconds
    }
    
    try:
        publish.single(
            topic=settings.MQTT_TOPIC_CONTROL,
            payload=json.dumps(payload),
            hostname=settings.MQTT_BROKER,
            port=settings.MQTT_PORT
        )
        return {
            "status": "spike_command_published",
            "target_node": request.node_id,
            "surge_water_level_cm": request.water_level_surge_cm,
            "topic": settings.MQTT_TOPIC_CONTROL
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to publish spike command: {e}")
