"""Focused regression tests for operator workflows."""
import pytest
from datetime import datetime, timezone
from app.anomaly_engine import AnomalyDetectionEngine
from app.schemas import ThresholdUpdate

def test_threshold_update_validation_and_engine_pickup():
    thresholds = ThresholdUpdate(water_level_watch=70, water_level_warning=110, water_level_critical=160)
    engine = AnomalyDetectionEngine()
    engine.set_node_thresholds("TEST", thresholds.model_dump())
    result = engine.process_reading("TEST", 165, 0, 20, datetime.now(timezone.utc))
    assert result["risk_level"] == "CRITICAL"

def test_alert_lifecycle_status_contract():
    from app.models import AlertModel
    alert = AlertModel(alert_id="A", source_node_id="N", source_node_name="N",
                       affected_settlement_id="S", affected_settlement_name="S",
                       eta_minutes=1, risk_level="WARNING", status="ACTIVE")
    assert alert.status == "ACTIVE"
    alert.status = "ACKNOWLEDGED"
    assert alert.status == "ACKNOWLEDGED"
    alert.status = "RESOLVED"
    assert alert.status == "RESOLVED"

def test_hsi_term_breakdown_is_returned():
    engine = AnomalyDetectionEngine()
    result = engine.process_reading("TERMS", 165, 12, 80, datetime.now(timezone.utc))
    assert {"s_level", "s_rate", "s_soil"}.issubset(result)
    assert result["hsi_score"] == round(
        result["s_level"] + 0.5 * result["s_rate"] + result["s_soil"], 2
    )

def test_node_status_exposes_last_reading_at():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.main import get_nodes
    from app.models import NodeModel, SensorReadingModel

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    timestamp = datetime.now(timezone.utc)
    db.add(NodeModel(
        node_id="NODE-READING", name="Reading Station", node_type="SENSOR_STATION",
        elevation_m=100, lat=27, lng=85, current_risk="NORMAL"
    ))
    db.add(SensorReadingModel(
        node_id="NODE-READING", rainfall_mm=1, water_level_cm=10,
        soil_moisture_pct=40, timestamp=timestamp, s_level=0.1,
        s_rate=0, s_soil=0, hsi_score=0.1, risk_level="NORMAL"
    ))
    db.commit()

    result = get_nodes(db=db)[0]

    assert result.last_reading_at == timestamp.replace(tzinfo=None)
    assert result.latest_reading["s_level"] == 0.1
    assert result.latest_reading["s_rate"] == 0
    assert result.latest_reading["s_soil"] == 0

def test_reset_simulation_publishes_command_and_resolves_open_alerts(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.main import reset_simulation
    from app.models import AlertModel, AlertHistoryModel, UserModel

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        AlertModel(
            alert_id="RESET-A", source_node_id="N", source_node_name="N",
            affected_settlement_id="S", affected_settlement_name="S",
            eta_minutes=1, risk_level="WARNING", status="ACTIVE"
        ),
        AlertModel(
            alert_id="RESET-B", source_node_id="N", source_node_name="N",
            affected_settlement_id="S2", affected_settlement_name="S2",
            eta_minutes=2, risk_level="CRITICAL", status="ACKNOWLEDGED"
        ),
    ])
    db.commit()
    published = {}
    monkeypatch.setattr("app.main.publish.single", lambda **kwargs: published.update(kwargs))

    result = reset_simulation(db=db, user=UserModel(username="operator", role="operator"))

    assert result["status"] == "simulation_reset"
    assert result["resolved_alerts"] == 2
    assert published["payload"] == '{"action": "RESET_SIMULATION"}'
    assert db.query(AlertModel).filter(AlertModel.status != "RESOLVED").count() == 0
    assert db.query(AlertHistoryModel).count() == 2

def test_open_alert_pair_is_unique_but_resolved_pair_can_reopen():
    from sqlalchemy import create_engine
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.models import AlertModel

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    fields = dict(
        source_node_id="NODE-UNIQUE", source_node_name="Unique station",
        affected_settlement_id="SETTLE-UNIQUE", affected_settlement_name="Unique settlement",
        eta_minutes=4, risk_level="WARNING"
    )
    db.add(AlertModel(alert_id="OPEN-1", status="ACTIVE", **fields))
    db.commit()
    db.add(AlertModel(alert_id="OPEN-2", status="ACKNOWLEDGED", **fields))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.query(AlertModel).filter(AlertModel.alert_id == "OPEN-1").update({"status": "RESOLVED"})
    db.commit()
    db.add(AlertModel(alert_id="OPEN-2", status="ACTIVE", **fields))
    db.commit()
    assert db.query(AlertModel).filter(AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"])).count() == 1
