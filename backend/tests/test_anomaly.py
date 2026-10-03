import pytest
from datetime import datetime, timezone, timedelta
from app.anomaly_engine import AnomalyDetectionEngine

def test_anomaly_normal_baseline():
    """Verify that steady readings remain in NORMAL risk classification."""
    engine = AnomalyDetectionEngine(window_size=10)
    engine.set_node_thresholds("NODE_TEST", {
        "water_level_watch": 100.0,
        "water_level_warning": 150.0,
        "water_level_critical": 200.0
    })

    t0 = datetime(2026, 9, 16, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(12):
        res = engine.process_reading(
            node_id="NODE_TEST",
            water_level_cm=45.0 + (i % 2) * 0.5,
            rainfall_mm=2.0,
            soil_moisture_pct=35.0,
            timestamp=t0 + timedelta(seconds=i * 5)
        )
    
    assert res["risk_level"] == "NORMAL"
    assert res["hsi_score"] < 1.0
    assert abs(res["ema_water_level"] - 45.0) < 2.0

def test_anomaly_flash_flood_spike():
    """Verify that rapid water surge triggers WARNING and CRITICAL risk levels."""
    engine = AnomalyDetectionEngine(window_size=10)
    engine.set_node_thresholds("NODE_TEST", {
        "water_level_watch": 100.0,
        "water_level_warning": 150.0,
        "water_level_critical": 200.0
    })

    t0 = datetime(2026, 9, 16, 12, 0, 0, tzinfo=timezone.utc)
    # Establish baseline
    for i in range(10):
        engine.process_reading(
            node_id="NODE_TEST",
            water_level_cm=50.0,
            rainfall_mm=3.0,
            soil_moisture_pct=40.0,
            timestamp=t0 + timedelta(seconds=i * 5)
        )

    # Cloudburst surge: water leaps from 50cm to 135cm in 5 seconds
    surge_1 = engine.process_reading(
        node_id="NODE_TEST",
        water_level_cm=135.0,
        rainfall_mm=80.0,
        soil_moisture_pct=85.0,
        timestamp=t0 + timedelta(seconds=55)
    )
    # Rate of change is 85cm in 5s (1020 cm/min) -> must immediately trigger WARNING or CRITICAL
    assert surge_1["risk_level"] in ("WARNING", "CRITICAL")
    assert surge_1["rate_of_change_cm_min"] > 10.0

    # Extreme surge to 210cm -> exceeds critical physical limit of 200cm
    surge_2 = engine.process_reading(
        node_id="NODE_TEST",
        water_level_cm=215.0,
        rainfall_mm=95.0,
        soil_moisture_pct=92.0,
        timestamp=t0 + timedelta(seconds=60)
    )
    assert surge_2["risk_level"] == "CRITICAL"
    assert surge_2["hsi_score"] >= 3.0

def test_risk_boundaries_are_explicit_and_ordered():
    t0 = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
    for level, expected in ((99.9, "NORMAL"), (100.0, "WATCH"), (150.0, "WARNING"), (200.0, "CRITICAL")):
        engine = AnomalyDetectionEngine()
        engine.set_node_thresholds("BOUNDARY", {
            "water_level_watch": 100.0,
            "water_level_warning": 150.0,
            "water_level_critical": 200.0,
        })
        assert engine.process_reading("BOUNDARY", level, 0, 20, t0)["risk_level"] == expected
