import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
import csv, io
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import paho.mqtt.publish as publish

from .config import settings
from .database import get_db, engine, Base, migrate_schema
from .models import NodeModel, SensorReadingModel, AlertModel, UserModel, AlertHistoryModel, IncidentModel, SettlementModel
from .schemas import (
    NodeStatus, ProcessedReading, SettlementAlert, SpikeInjectionRequest, LoginRequest, AlertTransitionRequest, ThresholdUpdate, SettlementUpdate
)
from .auth import hash_password, verify_password, create_token, current_user, require_operator
from .notifier import notifier
from .seed_data import seed_river_network
from .mqtt_client import mqtt_service
from .dispatcher import dispatcher
from .graph_engine import graph_engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes database, seeds graph network, and starts MQTT worker."""
    print("[*] [Startup] Initializing Flood Warning & Alert Routing Backend...")
    migrate_schema()
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

def _risk_reason(reading: SensorReadingModel, thresholds: dict) -> str:
    """Explain the first rule that places a reading in its persisted risk band."""
    watch = thresholds.get("water_level_watch", 100.0)
    warning = thresholds.get("water_level_warning", 150.0)
    critical = thresholds.get("water_level_critical", 200.0)
    level = reading.water_level_cm
    hsi = reading.hsi_score or 0.0
    rate = reading.rate_of_change_cm_min or 0.0
    if level >= critical or hsi >= 3.0 or (level >= warning and rate > 20.0):
        return f"CRITICAL when water >= {critical:g} cm, HSI >= 3.0, or warning-level surge > 20 cm/min"
    if level >= warning or hsi >= 2.0 or (level >= watch and rate > 12.0):
        return f"WARNING when water >= {warning:g} cm, HSI >= 2.0, or watch-level surge > 12 cm/min"
    if level >= watch or hsi >= 1.2 or rate > 8.0 or (reading.soil_moisture_pct or 0.0) > 85.0:
        return f"WATCH when water >= {watch:g} cm, HSI >= 1.2, surge > 8 cm/min, or soil > 85%"
    return "NORMAL: water level, surge rate, HSI, and soil moisture remain below watch rules"

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
        "active_alerts": db.query(AlertModel).filter(AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"])).count()
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
                "s_level": latest.s_level,
                "s_rate": latest.s_rate,
                "s_soil": latest.s_soil,
                "hsi_score": latest.hsi_score,
                "risk_level": latest.risk_level,
                "reason": _risk_reason(latest, json.loads(n.thresholds) if n.thresholds else {}),
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
            last_reading_at=latest.timestamp if latest else None,
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
        query = query.filter(AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
    alerts = query.order_by(AlertModel.created_at.desc()).limit(limit).all()
    return alerts

@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, request: Optional[AlertTransitionRequest] = None, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    """Marks an emergency alert as acknowledged."""
    alert = db.query(AlertModel).filter(AlertModel.alert_id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.status != "ACTIVE": raise HTTPException(409, "Alert is not ACTIVE")
    now = datetime.now(timezone.utc)
    note = request.note if request else None
    alert.acknowledged = True; alert.status = "ACKNOWLEDGED"; alert.acknowledged_at = now
    alert.acknowledged_by = user.username; alert.acknowledgment_note = note
    db.add(AlertHistoryModel(alert_id=alert_id, from_status="ACTIVE", to_status="ACKNOWLEDGED", changed_by=user.username, note=note))
    db.commit()
    return {"status": alert.status, "alert_id": alert_id}

@app.post("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str, request: AlertTransitionRequest = AlertTransitionRequest(), db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    alert = db.query(AlertModel).filter(AlertModel.alert_id == alert_id).first()
    if not alert: raise HTTPException(404, "Alert not found")
    if alert.status != "ACKNOWLEDGED": raise HTTPException(409, "Alert must be ACKNOWLEDGED before RESOLVED")
    now = datetime.now(timezone.utc); old = alert.status
    alert.status = "RESOLVED"; alert.resolved_at = now; alert.resolved_by = user.username; alert.acknowledged = True
    db.add(AlertHistoryModel(alert_id=alert_id, from_status=old, to_status="RESOLVED", changed_by=user.username, note=request.note))
    db.commit()
    return {"status": "RESOLVED", "alert_id": alert_id}

@app.get("/api/alerts/{alert_id}/history")
def alert_history(alert_id: str, db: Session = Depends(get_db), user: UserModel = Depends(current_user)):
    return db.query(AlertHistoryModel).filter(AlertHistoryModel.alert_id == alert_id).order_by(AlertHistoryModel.changed_at).all()

@app.post("/api/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash): raise HTTPException(401, "Incorrect username or password")
    return {
        "access_token": create_token(user),
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
    }

@app.post("/api/auth/users")
def create_user(request: LoginRequest, role: str = "viewer", db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    if role not in ("operator", "viewer"): raise HTTPException(422, "Invalid role")
    if db.query(UserModel).filter(UserModel.username == request.username).first(): raise HTTPException(409, "Username exists")
    created = UserModel(username=request.username, password_hash=hash_password(request.password), role=role)
    db.add(created); db.commit()
    return {"username": created.username, "role": created.role}

@app.put("/api/nodes/{node_id}/thresholds")
def update_thresholds(node_id: str, thresholds: ThresholdUpdate, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    node = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
    if not node: raise HTTPException(404, "Node not found")
    values = thresholds.dict(); node.thresholds = json.dumps(values)
    from .anomaly_engine import anomaly_engine
    anomaly_engine.set_node_thresholds(node_id, values); db.commit()
    return {"node_id": node_id, "thresholds": values}

@app.get("/api/settlements")
def get_settlements(db: Session = Depends(get_db)):
    """Returns editable settlement metadata for the public dashboard."""
    return db.query(SettlementModel).order_by(SettlementModel.name.asc()).all()

@app.put("/api/settlements/{settlement_id}")
def update_settlement(settlement_id: str, update: SettlementUpdate, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    settlement = db.query(SettlementModel).filter(SettlementModel.settlement_id == settlement_id).first()
    if not settlement: raise HTTPException(404, "Settlement not found")
    for key, value in update.dict(exclude_unset=True).items(): setattr(settlement, key, value)
    settlement.updated_at = datetime.now(timezone.utc); db.commit()
    if settlement_id in graph_engine.settlements_info:
        graph_engine.settlements_info[settlement_id].update(update.dict(exclude_unset=True))
    return settlement

@app.get("/api/incidents")
def incidents(db: Session = Depends(get_db), user: UserModel = Depends(current_user)):
    return db.query(IncidentModel).order_by(IncidentModel.started_at.desc()).all()

@app.get("/api/incidents/export.csv")
def export_incidents(db: Session = Depends(get_db), user: UserModel = Depends(current_user)):
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["incident_id","source_node_id","peak_risk","started_at","recovered_at","recovery_note"])
    for item in db.query(IncidentModel).order_by(IncidentModel.started_at).all():
        writer.writerow([item.incident_id,item.source_node_id,item.peak_risk,item.started_at,item.recovered_at,item.recovery_note])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition":"attachment; filename=incidents.csv"})

@app.get("/api/notifications/log")
def notification_log(user: UserModel = Depends(require_operator)):
    return notifier.logs

@app.post("/api/spike/inject")
def inject_spike(request: SpikeInjectionRequest, user: UserModel = Depends(require_operator)):
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

@app.post("/api/simulation/reset")
def reset_simulation(db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    """Return the simulator to baseline and close all open alert routes."""
    payload = {"action": "RESET_SIMULATION"}
    try:
        publish.single(
            topic=settings.MQTT_TOPIC_CONTROL,
            payload=json.dumps(payload),
            hostname=settings.MQTT_BROKER,
            port=settings.MQTT_PORT
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to publish reset command: {e}")

    now = datetime.now(timezone.utc)
    open_alerts = db.query(AlertModel).filter(
        AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"])
    ).all()
    for alert in open_alerts:
        old_status = alert.status
        alert.status = "RESOLVED"
        alert.resolved_at = now
        alert.resolved_by = user.username
        alert.acknowledged = True
        db.add(AlertHistoryModel(
            alert_id=alert.alert_id,
            from_status=old_status,
            to_status="RESOLVED",
            changed_by=user.username,
            note="Simulation reset"
        ))
    db.commit()
    return {
        "status": "simulation_reset",
        "resolved_alerts": len(open_alerts),
        "topic": settings.MQTT_TOPIC_CONTROL
    }
