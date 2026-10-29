import asyncio
import csv
import io
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache
from typing import List, Optional

import paho.mqtt.publish as publish
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .analytics import downsample, forecast, window_start
from .auth import (client_key, create_token, current_user, hash_password, login_limiter,
                   require_operator, subscribe_limiter, verify_password)
from .config import settings
from .database import get_db, migrate_schema
from .dispatcher import dispatcher
from .graph_engine import graph_engine
from .models import (AlertHistoryModel, AlertModel, ContactModel, IncidentModel, NodeModel,
                     NotificationModel, SensorReadingModel, SettlementModel, UserModel)
from .mqtt_client import mqtt_service
from .schemas import (AlertTransitionRequest, ContactCreate, LoginRequest, NewUserRequest, NodeStatus,
                      PublicSubscribe, SettlementUpdate, SpikeInjectionRequest, ThresholdUpdate)
from .seed_data import seed_river_network
from .topology import basin_meta, load_basins
from .weather import basin_outlook

OPEN_STATUSES = ["ACTIVE", "ACKNOWLEDGED"]
EMAIL_ADDRESS = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
_main_loop: Optional[asyncio.AbstractEventLoop] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes database, seeds graph network, and starts MQTT worker."""
    global _main_loop
    print("[*] [Startup] Initializing Flood Warning & Alert Routing Backend...")
    migrate_schema()
    seed_river_network()

    _main_loop = asyncio.get_running_loop()
    mqtt_service.start(_main_loop)
    print("[+] [Startup] MQTT Ingestion Service started.")

    yield

    print("[-] [Shutdown] Stopping MQTT Ingestion Service...")
    mqtt_service.stop()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Distributed IoT Sensor Ingestion, Custom Anomaly Detection & Graph-based Alert Routing API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,  # auth uses a bearer header, not cookies
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def _push(message: dict) -> None:
    """Broadcast to WebSocket clients from a synchronous (threadpool) endpoint."""
    if _main_loop and _main_loop.is_running():
        asyncio.run_coroutine_threadsafe(dispatcher.broadcast(message), _main_loop)


@lru_cache(maxsize=1)
def _basins() -> list:
    return load_basins()


def _basin_or_404(basin_id: str) -> dict:
    for basin in _basins():
        if basin["basin_id"] == basin_id:
            return basin
    raise HTTPException(status_code=404, detail="Basin not found")


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


def _alert_dict(alert: AlertModel) -> dict:
    return {
        "alert_id": alert.alert_id, "basin_id": alert.basin_id, "status": alert.status, "acknowledged": alert.acknowledged,
        "source_node_id": alert.source_node_id, "source_node_name": alert.source_node_name,
        "affected_settlement_id": alert.affected_settlement_id,
        "affected_settlement_name": alert.affected_settlement_name,
        "eta_minutes": alert.eta_minutes, "risk_level": alert.risk_level,
        "evacuation_zone": alert.evacuation_zone, "population_at_risk": alert.population_at_risk,
        "created_at": alert.created_at, "acknowledged_at": alert.acknowledged_at,
        "acknowledged_by": alert.acknowledged_by, "acknowledgment_note": alert.acknowledgment_note,
        "resolved_at": alert.resolved_at, "resolved_by": alert.resolved_by,
    }


# --- WebSocket Streaming Endpoint ---
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await dispatcher.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        dispatcher.disconnect(websocket)
    except Exception:
        dispatcher.disconnect(websocket)


# --- Health, stats, topology ---
@app.get("/api/health")
def health_check():
    last = mqtt_service.last_message_at
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "mqtt_broker": settings.MQTT_BROKER,
        "mqtt_port": settings.MQTT_PORT,
        "mqtt_connected": mqtt_service.connected,
        "last_message_at": last.isoformat() if last else None,
        "seconds_since_last_message": round((datetime.now(timezone.utc) - last).total_seconds(), 1) if last else None,
        "rejected_messages": mqtt_service.rejected_messages,
        "active_clients": len(dispatcher.active_connections),
        "basins": len(_basins()),
        "demo_controls_enabled": settings.DEMO_CONTROLS_ENABLED,
        "stale_after_seconds": settings.STALE_AFTER_SECONDS,
        "email_provider": settings.EMAIL_PROVIDER,
    }


def _basin_node_ids(db: Session, basin: Optional[str]) -> Optional[list]:
    if not basin:
        return None
    return [row[0] for row in db.query(NodeModel.node_id).filter(NodeModel.basin_id == basin).all()]


@app.get("/api/stats")
def get_stats(basin: Optional[str] = None, db: Session = Depends(get_db)):
    """Returns database telemetry counters and metrics, optionally for one basin."""
    node_ids = _basin_node_ids(db, basin)
    readings = db.query(SensorReadingModel)
    nodes = db.query(NodeModel)
    alerts = db.query(AlertModel).filter(AlertModel.status.in_(OPEN_STATUSES))
    if node_ids is not None:
        readings = readings.filter(SensorReadingModel.node_id.in_(node_ids))
        nodes = nodes.filter(NodeModel.basin_id == basin)
        alerts = alerts.filter(AlertModel.basin_id == basin)
    return {"total_readings": readings.count(), "total_nodes": nodes.count(), "active_alerts": alerts.count()}


@app.get("/api/basins")
def list_basins(db: Session = Depends(get_db)):
    """All configured basins with station, settlement and open-alert counts."""
    open_alerts = dict(db.query(AlertModel.basin_id, func.count(AlertModel.id))
                       .filter(AlertModel.status.in_(OPEN_STATUSES)).group_by(AlertModel.basin_id).all())
    return [{**basin_meta(basin), "stations": len(basin["nodes"]), "settlements": len(basin["settlements"]),
             "open_alerts": open_alerts.get(basin["basin_id"], 0)} for basin in _basins()]


@app.get("/api/basins/{basin_id}/weather")
def basin_weather(basin_id: str):
    """Free Open-Meteo rain outlook for every station of a basin (cached 30 min)."""
    basin = _basin_or_404(basin_id)
    return basin_outlook(basin_id, basin["nodes"])


@app.get("/api/network/topology")
def get_topology(basin: Optional[str] = None):
    """River topology graph for one basin (defaults to the first), for map drawing."""
    selected = _basin_or_404(basin) if basin else _basins()[0]
    return selected


# --- Stations & telemetry ---
@app.get("/api/nodes", response_model=List[NodeStatus])
def get_nodes(basin: Optional[str] = None, db: Session = Depends(get_db)):
    """Returns all sensor stations with current risk status and latest reading.

    A station that has not reported within STALE_AFTER_SECONDS is reported as STALE
    rather than showing its last (possibly dangerous or falsely calm) risk band.
    """
    results = []
    now = _naive_utc_now()
    nodes_query = db.query(NodeModel)
    if basin:
        nodes_query = nodes_query.filter(NodeModel.basin_id == basin)
    for n in nodes_query.order_by(NodeModel.id).all():
        latest = (
            db.query(SensorReadingModel)
            .filter(SensorReadingModel.node_id == n.node_id)
            .order_by(SensorReadingModel.timestamp.desc())
            .first()
        )
        thresholds = json.loads(n.thresholds) if n.thresholds else {}
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
                "reason": _risk_reason(latest, thresholds),
                "timestamp": latest.timestamp.isoformat() if latest.timestamp else None,
            }
        effective_risk = latest.risk_level if latest else (n.current_risk or "NORMAL")
        if latest and latest.timestamp:
            age = (now - latest.timestamp.replace(tzinfo=None)).total_seconds()
            if age > settings.STALE_AFTER_SECONDS:
                effective_risk = "STALE"
        elif not latest:
            effective_risk = "STALE"
        results.append(NodeStatus(
            node_id=n.node_id, basin_id=n.basin_id or "trishuli", name=n.name, node_type=n.node_type, elevation_m=n.elevation_m,
            lat=n.lat, lng=n.lng, description=n.description, current_risk=effective_risk,
            last_reading_at=latest.timestamp if latest else None,
            latest_reading=latest_dict, thresholds=thresholds,
        ))
    return results


def _node_or_404(db: Session, node_id: str) -> NodeModel:
    node = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Station not found")
    return node


@app.get("/api/nodes/{node_id}/readings")
def get_node_readings(
    node_id: str,
    limit: int = Query(50, ge=1, le=5000),
    hours: Optional[float] = Query(None, gt=0, le=24 * 30),
    db: Session = Depends(get_db),
):
    """Recent readings, oldest first. With `hours`, covers that window (downsampled to `limit` points)."""
    query = db.query(SensorReadingModel).filter(SensorReadingModel.node_id == node_id)
    if hours:
        rows = query.filter(SensorReadingModel.timestamp >= window_start(hours)).order_by(SensorReadingModel.timestamp.asc()).all()
        return downsample(rows, limit)
    rows = query.order_by(SensorReadingModel.timestamp.desc()).limit(limit).all()
    rows.reverse()
    return rows


@app.get("/api/nodes/{node_id}/forecast")
def get_node_forecast(node_id: str, minutes: int = Query(10, ge=2, le=60), db: Session = Depends(get_db)):
    """Short-horizon trend projection of when a station may reach each threshold."""
    node = _node_or_404(db, node_id)
    rows = (
        db.query(SensorReadingModel.timestamp, SensorReadingModel.water_level_cm)
        .filter(SensorReadingModel.node_id == node_id, SensorReadingModel.timestamp >= window_start(minutes / 60))
        .order_by(SensorReadingModel.timestamp.asc()).all()
    )
    result = forecast([(r[0], r[1]) for r in rows], json.loads(node.thresholds) if node.thresholds else {})
    result["node_id"] = node_id
    return result


@app.get("/api/analytics/summary")
def analytics_summary(hours: float = Query(24, gt=0, le=24 * 30), basin: Optional[str] = None, db: Session = Depends(get_db)):
    """Per-station statistics over a window, plus alert and incident counts."""
    start = window_start(hours)
    node_query = db.query(NodeModel)
    if basin:
        node_query = node_query.filter(NodeModel.basin_id == basin)
    names = {n.node_id: n.name for n in node_query.all()}
    stats = (
        db.query(
            SensorReadingModel.node_id, func.count(SensorReadingModel.id), func.min(SensorReadingModel.water_level_cm),
            func.avg(SensorReadingModel.water_level_cm), func.max(SensorReadingModel.water_level_cm),
            func.max(SensorReadingModel.hsi_score), func.max(SensorReadingModel.rainfall_mm),
        )
        .filter(SensorReadingModel.timestamp >= start, SensorReadingModel.node_id.in_(list(names)))
        .group_by(SensorReadingModel.node_id).all()
    )
    risk_rows = (
        db.query(SensorReadingModel.node_id, SensorReadingModel.risk_level, func.count(SensorReadingModel.id))
        .filter(SensorReadingModel.timestamp >= start, SensorReadingModel.node_id.in_(list(names)))
        .group_by(SensorReadingModel.node_id, SensorReadingModel.risk_level).all()
    )
    risk_counts: dict = {}
    for node_id, level, count in risk_rows:
        risk_counts.setdefault(node_id, {})[level] = count
    stations = [{
        "node_id": row[0], "name": names.get(row[0], row[0]), "readings": row[1],
        "water_min_cm": round(row[2], 2), "water_avg_cm": round(row[3], 2), "water_max_cm": round(row[4], 2),
        "hsi_max": round(row[5] or 0, 2), "rainfall_max_mm": round(row[6] or 0, 2),
        "risk_counts": risk_counts.get(row[0], {}),
    } for row in stats]
    alert_query = db.query(AlertModel).filter(AlertModel.created_at >= start)
    incident_query = db.query(IncidentModel).filter(IncidentModel.started_at >= start)
    if basin:
        alert_query = alert_query.filter(AlertModel.basin_id == basin)
        incident_query = incident_query.filter(IncidentModel.basin_id == basin)
    return {
        "hours": hours,
        "basin": basin,
        "stations": stations,
        "alerts_created": alert_query.count(),
        "incidents_started": incident_query.count(),
        "readings_total": sum(s["readings"] for s in stations),
    }


@app.get("/api/readings/export.csv")
def export_readings(node_id: Optional[str] = None, hours: float = Query(24, gt=0, le=24 * 30),
                    db: Session = Depends(get_db), user: UserModel = Depends(current_user)):
    query = db.query(SensorReadingModel).filter(SensorReadingModel.timestamp >= window_start(hours))
    if node_id:
        query = query.filter(SensorReadingModel.node_id == node_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp_utc", "node_id", "water_level_cm", "rainfall_mm", "soil_moisture_pct",
                     "ema_water_level", "rate_of_change_cm_min", "hsi_score", "risk_level"])
    for r in query.order_by(SensorReadingModel.timestamp).all():
        writer.writerow([r.timestamp, r.node_id, r.water_level_cm, r.rainfall_mm, r.soil_moisture_pct,
                         r.ema_water_level, r.rate_of_change_cm_min, r.hsi_score, r.risk_level])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=readings.csv"})


# --- Alerts ---
@app.get("/api/alerts")
def get_alerts(active_only: bool = False, status: Optional[str] = Query(None, pattern="^(ACTIVE|ACKNOWLEDGED|RESOLVED)$"),
               basin: Optional[str] = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    """Recent alert cascades, newest first."""
    query = db.query(AlertModel)
    if basin:
        query = query.filter(AlertModel.basin_id == basin)
    if active_only:
        query = query.filter(AlertModel.status.in_(OPEN_STATUSES))
    elif status:
        query = query.filter(AlertModel.status == status)
    return query.order_by(AlertModel.created_at.desc()).limit(limit).all()


def _transition(db: Session, alert_id: str, to_status: str, user: UserModel, note: Optional[str]) -> AlertModel:
    alert = db.query(AlertModel).filter(AlertModel.alert_id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    allowed = {"ACKNOWLEDGED": "ACTIVE", "RESOLVED": "ACKNOWLEDGED"}[to_status]
    if alert.status != allowed:
        raise HTTPException(status_code=409, detail=f"Alert must be {allowed} to become {to_status}")
    now = datetime.now(timezone.utc)
    old = alert.status
    alert.status = to_status
    alert.acknowledged = True
    if to_status == "ACKNOWLEDGED":
        alert.acknowledged_at, alert.acknowledged_by, alert.acknowledgment_note = now, user.username, note
    else:
        alert.resolved_at, alert.resolved_by = now, user.username
    db.add(AlertHistoryModel(alert_id=alert_id, from_status=old, to_status=to_status, changed_by=user.username, note=note))
    db.commit()
    _push({"type": "ALERT_UPDATED", "data": json.loads(json.dumps(_alert_dict(alert), default=str))})
    return alert


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, request: Optional[AlertTransitionRequest] = None,
                      db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    """Marks an emergency alert as acknowledged."""
    alert = _transition(db, alert_id, "ACKNOWLEDGED", user, request.note if request else None)
    return {"status": alert.status, "alert_id": alert_id}


@app.post("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str, request: AlertTransitionRequest = AlertTransitionRequest(),
                  db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    alert = _transition(db, alert_id, "RESOLVED", user, request.note)
    return {"status": alert.status, "alert_id": alert_id}


@app.get("/api/alerts/{alert_id}/history")
def alert_history(alert_id: str, db: Session = Depends(get_db)):
    return db.query(AlertHistoryModel).filter(AlertHistoryModel.alert_id == alert_id).order_by(AlertHistoryModel.changed_at).all()


# --- Auth & users ---
@app.post("/api/auth/login")
def login(request: LoginRequest, http: Request, db: Session = Depends(get_db)):
    login_limiter.check(f"{client_key(http)}:{request.username.lower()}")
    user = db.query(UserModel).filter(UserModel.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password")
    return {"access_token": create_token(user), "token_type": "bearer", "username": user.username, "role": user.role}


@app.post("/api/auth/users")
def create_user(request: NewUserRequest, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    if request.role not in ("operator", "viewer"):
        raise HTTPException(422, "Invalid role")
    if db.query(UserModel).filter(UserModel.username == request.username).first():
        raise HTTPException(409, "Username exists")
    created = UserModel(username=request.username, password_hash=hash_password(request.password), role=request.role)
    db.add(created)
    db.commit()
    return {"username": created.username, "role": created.role}


# --- Configuration ---
@app.put("/api/nodes/{node_id}/thresholds")
def update_thresholds(node_id: str, thresholds: ThresholdUpdate, db: Session = Depends(get_db),
                      user: UserModel = Depends(require_operator)):
    node = _node_or_404(db, node_id)
    values = thresholds.model_dump()
    node.thresholds = json.dumps(values)
    from .anomaly_engine import anomaly_engine
    anomaly_engine.set_node_thresholds(node_id, values)
    db.commit()
    return {"node_id": node_id, "thresholds": values}


def _settlement_positions() -> dict:
    return {s["settlement_id"]: s for b in _basins() for s in b["settlements"]}


def _settlement_out(settlement: SettlementModel, positions: Optional[dict] = None) -> dict:
    """A settlement row plus its map position, which lives in the basin file rather than the database."""
    position = (positions if positions is not None else _settlement_positions()).get(settlement.settlement_id, {})
    return {"id": settlement.id, "settlement_id": settlement.settlement_id, "basin_id": settlement.basin_id, "name": settlement.name,
            "evacuation_zone": settlement.evacuation_zone, "population": settlement.population,
            "updated_at": settlement.updated_at, "lat": position.get("lat"), "lng": position.get("lng")}


@app.get("/api/settlements")
def get_settlements(basin: Optional[str] = None, db: Session = Depends(get_db)):
    """Settlement metadata for the dashboard and public bulletin."""
    query = db.query(SettlementModel)
    if basin:
        query = query.filter(SettlementModel.basin_id == basin)
    positions = _settlement_positions()
    return [_settlement_out(s, positions) for s in query.order_by(SettlementModel.name.asc()).all()]


@app.put("/api/settlements/{settlement_id}")
def update_settlement(settlement_id: str, update: SettlementUpdate, db: Session = Depends(get_db),
                      user: UserModel = Depends(require_operator)):
    settlement = db.query(SettlementModel).filter(SettlementModel.settlement_id == settlement_id).first()
    if not settlement:
        raise HTTPException(404, "Settlement not found")
    changes = update.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(settlement, key, value)
    settlement.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(settlement)
    if settlement_id in graph_engine.settlements_info:
        graph_engine.settlements_info[settlement_id].update(changes)
    return _settlement_out(settlement)


# --- Incidents ---
@app.get("/api/incidents")
def incidents(basin: Optional[str] = None, limit: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    query = db.query(IncidentModel)
    if basin:
        query = query.filter(IncidentModel.basin_id == basin)
    return query.order_by(IncidentModel.started_at.desc()).limit(limit).all()


@app.get("/api/incidents/export.csv")
def export_incidents(db: Session = Depends(get_db), user: UserModel = Depends(current_user)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["incident_id", "source_node_id", "peak_risk", "started_at", "recovered_at", "recovery_note"])
    for item in db.query(IncidentModel).order_by(IncidentModel.started_at).all():
        writer.writerow([item.incident_id, item.source_node_id, item.peak_risk, item.started_at, item.recovered_at, item.recovery_note])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=incidents.csv"})


# --- Contacts, public subscription, notification log ---
def _normalize_email(raw: str) -> str:
    address = (raw or "").strip().lower()
    if not EMAIL_ADDRESS.match(address):
        raise HTTPException(422, "Enter a valid email address (e.g. name@example.com)")
    return address


def _settlement_or_404(db: Session, settlement_id: str) -> SettlementModel:
    settlement = db.query(SettlementModel).filter(SettlementModel.settlement_id == settlement_id).first()
    if not settlement:
        raise HTTPException(404, "Settlement not found")
    return settlement


@app.get("/api/contacts")
def list_contacts(db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    return db.query(ContactModel).order_by(ContactModel.settlement_id, ContactModel.name).all()


@app.post("/api/contacts", status_code=201)
def add_contact(request: ContactCreate, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    _settlement_or_404(db, request.settlement_id)
    contact = ContactModel(settlement_id=request.settlement_id, name=request.name.strip(),
                           email=_normalize_email(request.email), language=request.language, source="operator")
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@app.delete("/api/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    contact = db.query(ContactModel).filter(ContactModel.id == contact_id).first()
    if not contact:
        raise HTTPException(404, "Contact not found")
    db.delete(contact)
    db.commit()
    return {"deleted": contact_id}


@app.post("/api/public/subscribe", status_code=201)
def public_subscribe(request: PublicSubscribe, http: Request, db: Session = Depends(get_db)):
    """Residents register an email address for alerts for their settlement (no account needed)."""
    subscribe_limiter.check(client_key(http))
    _settlement_or_404(db, request.settlement_id)
    email = _normalize_email(request.email)
    existing = db.query(ContactModel).filter(ContactModel.settlement_id == request.settlement_id, ContactModel.email == email).first()
    if existing:
        existing.active, existing.language = True, request.language
    else:
        db.add(ContactModel(settlement_id=request.settlement_id, name="Resident", email=email,
                            language=request.language, source="public"))
    db.commit()
    return {"status": "subscribed", "settlement_id": request.settlement_id}


@app.get("/api/notifications/log")
def notification_log(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db),
                     user: UserModel = Depends(require_operator)):
    return db.query(NotificationModel).order_by(NotificationModel.created_at.desc()).limit(limit).all()


# --- Demo controls ---
def _publish_control(payload: dict) -> None:
    auth = {"username": settings.MQTT_USERNAME, "password": settings.MQTT_PASSWORD} if settings.MQTT_USERNAME else None
    try:
        if mqtt_service.connected and mqtt_service.client:
            # Reuse the live connection: no new TCP/TLS handshake and a bounded wait.
            mqtt_service.publish_control(settings.MQTT_TOPIC_CONTROL, json.dumps(payload))
        else:
            publish.single(topic=settings.MQTT_TOPIC_CONTROL, payload=json.dumps(payload),
                           hostname=settings.MQTT_BROKER, port=settings.MQTT_PORT, auth=auth)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to publish control command: {e}")


def _require_demo_enabled() -> None:
    if not settings.DEMO_CONTROLS_ENABLED:
        raise HTTPException(status_code=403, detail="Demo controls are disabled on this installation")


@app.post("/api/spike/inject")
def inject_spike(request: SpikeInjectionRequest, db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    """Triggers a simulated flood surge on a station for demonstrations."""
    _require_demo_enabled()
    if request.node_id != "ALL":
        _node_or_404(db, request.node_id)
    _publish_control({
        "action": "INJECT_SPIKE", "node_id": request.node_id,
        "water_level_surge_cm": request.water_level_surge_cm, "rainfall_surge_mm": request.rainfall_surge_mm,
        "soil_moisture_surge_pct": request.soil_moisture_surge_pct, "duration_seconds": request.duration_seconds,
    })
    return {"status": "spike_command_published", "target_node": request.node_id,
            "surge_water_level_cm": request.water_level_surge_cm}


@app.post("/api/simulation/reset")
def reset_simulation(db: Session = Depends(get_db), user: UserModel = Depends(require_operator)):
    """Return the simulator to baseline and close all open alert routes."""
    _require_demo_enabled()
    _publish_control({"action": "RESET_SIMULATION"})
    now = datetime.now(timezone.utc)
    open_alerts = db.query(AlertModel).filter(AlertModel.status.in_(OPEN_STATUSES)).all()
    for alert in open_alerts:
        old_status = alert.status
        alert.status = "RESOLVED"
        alert.resolved_at = now
        alert.resolved_by = user.username
        alert.acknowledged = True
        db.add(AlertHistoryModel(alert_id=alert.alert_id, from_status=old_status, to_status="RESOLVED",
                                 changed_by=user.username, note="Simulation reset"))
    db.commit()
    _push({"type": "ALERTS_REFRESH"})
    return {"status": "simulation_reset", "resolved_alerts": len(open_alerts), "topic": settings.MQTT_TOPIC_CONTROL}
