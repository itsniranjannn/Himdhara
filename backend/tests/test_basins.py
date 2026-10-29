"""Multi-basin behaviour: data files, routing isolation, API filtering, free weather + email delivery."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import weather
from app.config import settings
from app.database import Base, get_db
from app.graph_engine import GraphAlertPropagationEngine
from app.main import app
from app.models import AlertModel, ContactModel, IncidentModel, NodeModel, NotificationModel, SettlementModel
from app.notifier import notifier
from app.topology import BASINS_DIR, TopologyError, load_basins, merged, validate_basins

EXPECTED_BASINS = {"trishuli", "bagmati", "koshi", "karnali", "gandaki"}


# ---- data files ----
def test_all_basin_files_load_and_validate():
    basins = load_basins()
    assert {b["basin_id"] for b in basins} == EXPECTED_BASINS
    for basin in basins:
        assert len(basin["nodes"]) >= 3 and len(basin["settlements"]) >= 3
        assert all(n["basin_id"] == basin["basin_id"] for n in basin["nodes"])


def test_ids_are_globally_unique():
    data = merged(load_basins())
    node_ids = [n["node_id"] for n in data["nodes"]]
    settlement_ids = [s["settlement_id"] for s in data["settlements"]]
    assert len(node_ids) == len(set(node_ids)) and len(settlement_ids) == len(set(settlement_ids))


def test_every_station_reaches_a_settlement():
    for basin in load_basins():
        engine = GraphAlertPropagationEngine()
        engine.load_data({"nodes": basin["nodes"], "settlements": basin["settlements"]})
        for node in basin["nodes"]:
            routes = engine.propagate_alert(node["node_id"], "CRITICAL")
            assert routes, f"{node['node_id']} reaches no settlement"
            assert [r["eta_minutes"] for r in routes] == sorted(r["eta_minutes"] for r in routes)
            assert all(r["basin_id"] == basin["basin_id"] for r in routes)


def test_alerts_never_cross_basins():
    engine = GraphAlertPropagationEngine(BASINS_DIR)
    owner = {s["settlement_id"]: s["basin_id"] for s in merged(load_basins())["settlements"]}
    for basin in load_basins():
        for node in basin["nodes"]:
            for route in engine.propagate_alert(node["node_id"], "CRITICAL"):
                assert owner[route["affected_settlement_id"]] == basin["basin_id"]


@pytest.mark.parametrize("mutate,message", [
    (lambda b: b[1]["nodes"].append(dict(b[0]["nodes"][0])), "appears in both"),
    (lambda b: b[0]["nodes"][0].__setitem__("lat", 51.0), "outside Nepal"),
    (lambda b: b[0]["nodes"][0].__setitem__("thresholds", {"water_level_watch": 9, "water_level_warning": 5, "water_level_critical": 20}), "strictly increasing"),
    (lambda b: b[0]["nodes"][0]["downstream_targets"].append({"target_id": "GHOST", "travel_time_min": 5}), "unknown downstream"),
    (lambda b: b[0]["nodes"][0]["downstream_targets"].append({"target_id": b[0]["settlements"][0]["settlement_id"], "travel_time_min": 0}), "positive"),
])
def test_validation_rejects_bad_basin_data(mutate, message):
    basins = json.loads(json.dumps(load_basins()))
    mutate(basins)
    with pytest.raises(TopologyError, match=message):
        validate_basins(basins)


# ---- API ----
@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    for basin_id, prefix in (("trishuli", "A"), ("bagmati", "B")):
        session.add(NodeModel(node_id=f"N_{prefix}", basin_id=basin_id, name=f"Station {prefix}", elevation_m=1, lat=27, lng=85))
        session.add(SettlementModel(settlement_id=f"S_{prefix}", basin_id=basin_id, name=f"Town {prefix}"))
        session.add(AlertModel(alert_id=f"AL_{prefix}", basin_id=basin_id, source_node_id=f"N_{prefix}", source_node_name=f"Station {prefix}",
                               affected_settlement_id=f"S_{prefix}", affected_settlement_name=f"Town {prefix}", eta_minutes=3, risk_level="WARNING", status="ACTIVE"))
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_basins_endpoint_lists_every_basin_with_counts(client):
    rows = client.get("/api/basins").json()
    assert {r["basin_id"] for r in rows} == EXPECTED_BASINS
    trishuli = next(r for r in rows if r["basin_id"] == "trishuli")
    assert trishuli["stations"] == 6 and trishuli["open_alerts"] == 1 and trishuli["simulated"] is True
    assert "nodes" not in trishuli  # headers only; topology has its own endpoint


def test_endpoints_filter_by_basin(client):
    assert [n["node_id"] for n in client.get("/api/nodes?basin=bagmati").json()] == ["N_B"]
    assert [a["alert_id"] for a in client.get("/api/alerts?basin=trishuli").json()] == ["AL_A"]
    assert [s["settlement_id"] for s in client.get("/api/settlements?basin=bagmati").json()] == ["S_B"]
    assert len(client.get("/api/nodes").json()) == 2
    assert client.get("/api/stats?basin=bagmati").json()["active_alerts"] == 1
    assert client.get("/api/analytics/summary?basin=bagmati").json()["stations"] == []


def test_topology_endpoint_returns_requested_basin(client):
    body = client.get("/api/network/topology?basin=karnali").json()
    assert body["basin_id"] == "karnali" and len(body["nodes"]) == 3
    assert client.get("/api/network/topology?basin=atlantis").status_code == 404


# ---- free weather (Open-Meteo) ----
def fake_response(*daily_totals):
    return [{"hourly": {"precipitation": [t / 24] * 72}} for t in daily_totals]


def test_rain_classification_bands():
    assert [weather.classify(v) for v in (0, 15.5, 15.6, 64.4, 64.5, 115.5, 300)] == ["LOW", "LOW", "MODERATE", "MODERATE", "HEAVY", "VERY_HEAVY", "VERY_HEAVY"]


def test_outlook_summarises_each_station_and_caches():
    weather.clear_cache()
    stations = [{"node_id": "A", "name": "A", "lat": 27.1, "lng": 85.1}, {"node_id": "B", "name": "B", "lat": 27.2, "lng": 85.2}]
    calls = []
    fetcher = lambda url: calls.append(url) or fake_response(10, 70)
    first = weather.basin_outlook("demo", stations, fetcher, now=1000)
    assert first["status"] == "OK" and first["level"] == "HEAVY"
    assert [s["level"] for s in first["stations"]] == ["LOW", "HEAVY"]
    assert first["stations"][1]["next_72h_mm"] == pytest.approx(210, abs=0.5)
    assert "latitude=27.1%2C27.2" in calls[0]
    weather.basin_outlook("demo", stations, fetcher, now=1500)
    assert len(calls) == 1  # served from cache within 30 minutes


def test_outlook_degrades_gracefully_when_service_is_down():
    weather.clear_cache()
    stations = [{"node_id": "A", "name": "A", "lat": 27.1, "lng": 85.1}]
    def down(url): raise OSError("network unreachable")
    assert weather.basin_outlook("demo", stations, down, now=0)["status"] == "UNAVAILABLE"
    weather.basin_outlook("demo2", stations, lambda url: fake_response(5), now=0)
    stale = weather.basin_outlook("demo2", stations, down, now=weather.CACHE_SECONDS + 1)
    assert stale["status"] == "STALE" and stale["stations"]  # last good forecast kept


def test_weather_endpoint_never_errors(client, monkeypatch):
    weather.clear_cache()
    monkeypatch.setattr("app.weather.fetch_outlook", lambda stations, fetcher=None: (_ for _ in ()).throw(OSError("offline")))
    body = client.get("/api/basins/bagmati/weather").json()
    assert body["status"] == "UNAVAILABLE"
    assert client.get("/api/basins/atlantis/weather").status_code == 404


# ---- email delivery (the only channel) ----
def test_email_alert_goes_to_each_registered_contact_once(db, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "smtp")
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(settings, "SMTP_FROM", "alerts@test")
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=0): sent.append(("connect", host))
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def starttls(self): sent.append(("tls",))
        def login(self, user, password): sent.append(("login", user))
        def send_message(self, message): sent.append(("mail", message["To"], message["Subject"]))

    monkeypatch.setattr("app.notifier.smtplib.SMTP", FakeSMTP)
    db.add_all([ContactModel(settlement_id="S_A", name="x", email="x@example.com"), ContactModel(settlement_id="S_A", name="y", email="y@example.com", language="ne")])
    db.commit()
    alert = {"alert_id": "AL_A", "affected_settlement_id": "S_A", "affected_settlement_name": "Town A", "risk_level": "CRITICAL", "eta_minutes": 9}
    assert notifier.notify_alert(db, alert) == 2
    mails = [s for s in sent if s[0] == "mail"]
    assert [m[1] for m in mails] == ["x@example.com", "y@example.com"]
    assert "Flood CRITICAL" in mails[0][2] and "अति खतरा" in mails[1][2]
    assert {r.status for r in db.query(NotificationModel).all()} == {"SENT"}


def test_email_failure_is_logged_and_hides_the_password(db, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "smtp")
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(settings, "SMTP_FROM", "alerts@test")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "hunter2")
    def boom(*args, **kwargs): raise OSError("auth failed for hunter2")
    monkeypatch.setattr("app.notifier.smtplib.SMTP", boom)
    status, error = notifier.send_email("x@example.com", "subject", "body")
    assert status == "FAILED" and "hunter2" not in error


def test_coordinates_are_inside_nepal_and_settlements_sit_near_their_station():
    import math
    from app import topology

    def km(a, b):
        k = math.cos(math.radians(a["lat"]))
        return math.hypot((a["lat"] - b["lat"]) * 111.0, (a["lng"] - b["lng"]) * 111.0 * k)

    for basin in topology.load_basins():
        by_id = {n["node_id"]: n for n in basin["nodes"]}
        by_settlement = {s["settlement_id"]: s for s in basin["settlements"]}
        for p in list(basin["nodes"]) + list(basin["settlements"]):
            assert 26.3 <= p["lat"] <= 30.5 and 80.0 <= p["lng"] <= 88.3, p["name"]
        for n in basin["nodes"]:
            for t in n.get("downstream_targets", []):
                if t["type"] == "settlement":
                    assert km(n, by_settlement[t["target_id"]]) < 40, (n["name"], t["target_id"])
