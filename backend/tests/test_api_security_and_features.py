"""HTTP-level tests on an isolated in-memory database (never touches flood_system.db)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth as auth_module
from app.analytics import forecast
from app.auth import create_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import (AlertModel, ContactModel, NodeModel, NotificationModel, SensorReadingModel,
                        SettlementModel, UserModel)
from app.mqtt_client import MQTTIngestionService
from app.notifier import build_message, notifier


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        UserModel(username="op", password_hash=hash_password("operator-pass-1"), role="operator"),
        UserModel(username="view", password_hash=hash_password("viewer-pass-12"), role="viewer"),
        NodeModel(node_id="N1", name="Station 1", elevation_m=1, lat=27, lng=85, current_risk="NORMAL",
                  thresholds='{"water_level_watch": 100, "water_level_warning": 150, "water_level_critical": 200}'),
        SettlementModel(settlement_id="S1", name="Town", evacuation_zone="School ground", population=1000),
    ])
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    auth_module.login_limiter.reset()
    auth_module.subscribe_limiter.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()


def bearer(db, username):
    user = db.query(UserModel).filter(UserModel.username == username).first()
    return {"Authorization": f"Bearer {create_token(user)}"}


def add_alert(db, status="ACTIVE", alert_id="A1"):
    db.add(AlertModel(alert_id=alert_id, source_node_id="N1", source_node_name="Station 1",
                      affected_settlement_id="S1", affected_settlement_name="Town",
                      eta_minutes=5, risk_level="WARNING", status=status))
    db.commit()


# ---- authentication / authorization ----
def test_anonymous_can_read_public_data(client):
    assert client.get("/api/nodes").status_code == 200
    assert client.get("/api/alerts").status_code == 200
    assert client.get("/api/incidents").status_code == 200
    assert client.get("/api/settlements").status_code == 200


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/spike/inject", {"node_id": "N1"}),
    ("post", "/api/simulation/reset", None),
    ("post", "/api/alerts/A1/acknowledge", None),
    ("put", "/api/nodes/N1/thresholds", {"water_level_watch": 1, "water_level_warning": 2, "water_level_critical": 3}),
    ("get", "/api/contacts", None),
    ("get", "/api/notifications/log", None),
])
def test_write_and_sensitive_endpoints_reject_anonymous(client, method, path, body):
    response = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
    assert response.status_code == 401


def test_viewer_cannot_operate(client, db):
    add_alert(db)
    response = client.post("/api/alerts/A1/acknowledge", headers=bearer(db, "view"))
    assert response.status_code == 403


def test_login_rejects_bad_password_and_rate_limits(client):
    assert client.post("/api/auth/login", json={"username": "op", "password": "wrong"}).status_code == 401
    ok = client.post("/api/auth/login", json={"username": "op", "password": "operator-pass-1"})
    assert ok.status_code == 200 and ok.json()["role"] == "operator"
    for _ in range(10):
        last = client.post("/api/auth/login", json={"username": "op", "password": "wrong"})
    assert last.status_code == 429


def test_forged_and_expired_tokens_are_rejected(client):
    assert client.get("/api/contacts", headers={"Authorization": "Bearer a.b.c"}).status_code == 401


# ---- alert lifecycle ----
def test_alert_lifecycle_and_order_enforced(client, db):
    add_alert(db)
    headers = bearer(db, "op")
    assert client.post("/api/alerts/A1/resolve", headers=headers).status_code == 409  # must acknowledge first
    ack = client.post("/api/alerts/A1/acknowledge", json={"note": "seen"}, headers=headers)
    assert ack.status_code == 200 and ack.json()["status"] == "ACKNOWLEDGED"
    assert client.post("/api/alerts/A1/acknowledge", headers=headers).status_code == 409
    assert client.post("/api/alerts/A1/resolve", headers=headers).json()["status"] == "RESOLVED"
    history = client.get("/api/alerts/A1/history").json()
    assert [h["to_status"] for h in history] == ["ACKNOWLEDGED", "RESOLVED"]
    assert client.get("/api/alerts?status=RESOLVED").json()[0]["alert_id"] == "A1"


# ---- stale detection, readings, forecast, analytics ----
def add_readings(db, levels, step_seconds=60, age_seconds=0):
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=age_seconds)
    for i, level in enumerate(levels):
        ts = now - timedelta(seconds=(len(levels) - 1 - i) * step_seconds)
        db.add(SensorReadingModel(node_id="N1", rainfall_mm=0, water_level_cm=level, soil_moisture_pct=40,
                                  timestamp=ts, hsi_score=0.5, risk_level="NORMAL"))
    db.commit()


def test_node_without_recent_reading_is_stale(client, db):
    assert client.get("/api/nodes").json()[0]["current_risk"] == "STALE"  # never reported
    add_readings(db, [50, 51], age_seconds=3600)
    assert client.get("/api/nodes").json()[0]["current_risk"] == "STALE"  # silent for an hour
    add_readings(db, [52])
    assert client.get("/api/nodes").json()[0]["current_risk"] == "NORMAL"


def test_forecast_projects_threshold_crossing():
    now = datetime(2026, 1, 1, 12, 0, 0)
    readings = [(now + timedelta(minutes=i), 100 + 10 * i) for i in range(6)]  # +10 cm/min
    result = forecast(readings, {"water_level_watch": 100, "water_level_warning": 150, "water_level_critical": 200})
    assert result["trend"] == "RISING" and result["slope_cm_min"] == pytest.approx(10, abs=0.01)
    assert result["minutes_to"]["watch"] == 0.0
    assert result["minutes_to"]["critical"] == pytest.approx(5.0, abs=0.1)


def test_forecast_needs_enough_points_and_ignores_falling_trend():
    now = datetime(2026, 1, 1, 12, 0, 0)
    assert forecast([(now, 1), (now + timedelta(minutes=1), 2)], {})["status"] == "INSUFFICIENT_DATA"
    falling = [(now + timedelta(minutes=i), 120 - 5 * i) for i in range(6)]
    result = forecast(falling, {"water_level_critical": 200})
    assert result["trend"] == "FALLING" and result["minutes_to"]["critical"] is None


def test_readings_window_and_analytics_summary(client, db):
    add_readings(db, [60, 70, 80, 90, 100, 110], step_seconds=30)
    rows = client.get("/api/nodes/N1/readings?hours=1&limit=3").json()
    assert len(rows) == 3 and rows[-1]["water_level_cm"] == 110
    summary = client.get("/api/analytics/summary?hours=1").json()
    station = summary["stations"][0]
    assert station["water_min_cm"] == 60 and station["water_max_cm"] == 110 and station["readings"] == 6
    assert client.get("/api/nodes/NOPE/forecast").status_code == 404
    assert client.get("/api/nodes/N1/forecast").json()["status"] == "OK"


def test_input_bounds_are_validated(client, db):
    headers = bearer(db, "op")
    assert client.post("/api/spike/inject", json={"node_id": "N1", "water_level_surge_cm": 9999}, headers=headers).status_code == 422
    assert client.post("/api/spike/inject", json={"node_id": "GHOST"}, headers=headers).status_code == 404
    assert client.get("/api/nodes/N1/readings?limit=999999").status_code == 422


# ---- contacts, subscription, notifications ----
def test_public_subscribe_validates_and_is_idempotent(client, db):
    bad = client.post("/api/public/subscribe", json={"settlement_id": "S1", "email": "not-an-email"})
    assert bad.status_code == 422
    assert client.post("/api/public/subscribe", json={"settlement_id": "NOPE", "email": "a@example.com"}).status_code == 404
    assert client.post("/api/public/subscribe", json={"settlement_id": "S1", "email": "A@Example.com", "language": "ne"}).status_code == 201
    assert client.post("/api/public/subscribe", json={"settlement_id": "S1", "email": "a@example.com"}).status_code == 201
    contacts = db.query(ContactModel).all()
    assert len(contacts) == 1 and contacts[0].email == "a@example.com"


def test_public_subscribe_is_rate_limited(client):
    for _ in range(5):
        client.post("/api/public/subscribe", json={"settlement_id": "S1", "email": "a@example.com"})
    assert client.post("/api/public/subscribe", json={"settlement_id": "S1", "email": "a@example.com"}).status_code == 429


def test_contacts_are_operator_only_and_validated(client, db):
    headers = bearer(db, "op")
    assert client.post("/api/contacts", json={"settlement_id": "S1", "name": "Ward office"}, headers=headers).status_code == 422
    assert client.post("/api/contacts", json={"settlement_id": "S1", "name": "Ward office", "email": "nope"}, headers=headers).status_code == 422
    created = client.post("/api/contacts", json={"settlement_id": "S1", "name": "Ward office", "email": "ward@example.com"}, headers=headers)
    assert created.status_code == 201
    assert client.get("/api/contacts", headers=bearer(db, "view")).status_code == 403
    assert client.delete(f"/api/contacts/{created.json()['id']}", headers=headers).status_code == 200


def test_notifier_logs_per_contact_in_their_language(db):
    db.add(ContactModel(settlement_id="S1", name="A", email="a@example.com", language="ne"))
    db.add(ContactModel(settlement_id="S1", name="B", email="b@example.com", language="en"))
    db.commit()
    alert = {"alert_id": "A1", "affected_settlement_id": "S1", "affected_settlement_name": "Town",
             "risk_level": "CRITICAL", "eta_minutes": 12, "evacuation_zone": "School ground"}
    assert notifier.notify_alert(db, alert) == 2
    rows = db.query(NotificationModel).order_by(NotificationModel.id).all()
    assert all(r.status == "SIMULATED" and r.channel == "email" for r in rows)
    assert "अति खतरा" in rows[0].content and "FLOOD CRITICAL" in rows[1].content


def test_notifier_records_gap_when_no_contacts(db):
    alert = {"alert_id": "A1", "affected_settlement_id": "S1", "affected_settlement_name": "Town",
             "risk_level": "WARNING", "eta_minutes": 5}
    assert notifier.notify_alert(db, alert) == 1
    assert db.query(NotificationModel).one().error == "No contacts registered"


def test_message_templates():
    alert = {"affected_settlement_name": "Town", "risk_level": "WARNING", "eta_minutes": 4.0, "evacuation_zone": "Ridge"}
    assert build_message(alert) == "FLOOD WARNING: Town. Flood wave ETA 4 min. Move to Ridge now."
    assert "४" in build_message(alert, "ne")


# ---- telemetry ingestion validation ----
@pytest.mark.parametrize("payload,reason", [
    ({"node_id": "GHOST", "water_level_cm": 1, "rainfall_mm": 1, "soil_moisture_pct": 1}, "unknown node_id"),
    ({"node_id": "N1", "water_level_cm": "abc", "rainfall_mm": 1, "soil_moisture_pct": 1}, "not numeric"),
    ({"node_id": "N1", "water_level_cm": -5, "rainfall_mm": 1, "soil_moisture_pct": 1}, "out of range"),
    ({"node_id": "N1", "water_level_cm": float("nan"), "rainfall_mm": 1, "soil_moisture_pct": 1}, "out of range"),
    ({"node_id": "N1", "water_level_cm": 1, "rainfall_mm": 1, "soil_moisture_pct": 500}, "out of range"),
    ({"node_id": "N1", "rainfall_mm": 1, "soil_moisture_pct": 1}, "missing"),
])
def test_bad_telemetry_is_rejected(payload, reason):
    assert reason in MQTTIngestionService.validate_payload(payload, {"N1"})


def test_good_telemetry_is_accepted():
    good = {"node_id": "N1", "water_level_cm": 90.5, "rainfall_mm": 2, "soil_moisture_pct": 40}
    assert MQTTIngestionService.validate_payload(good, {"N1"}) is None
