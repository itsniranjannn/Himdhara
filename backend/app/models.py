from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text
from .database import Base

class NodeModel(Base):
    __tablename__ = "nodes"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    node_type = Column(String(30), default="SENSOR_STATION")
    elevation_m = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    description = Column(String(255), nullable=True)
    downstream_targets = Column(Text, nullable=True)  # JSON string of targets & travel times
    thresholds = Column(Text, nullable=True)          # JSON string of alert thresholds
    current_risk = Column(String(20), default="NORMAL")
    last_updated = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class SensorReadingModel(Base):
    __tablename__ = "sensor_readings"
    
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String(50), index=True, nullable=False)
    rainfall_mm = Column(Float, nullable=False)
    water_level_cm = Column(Float, nullable=False)
    soil_moisture_pct = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    
    # Computed metrics from Anomaly Detection Engine (Module C)
    ema_water_level = Column(Float, nullable=True)
    rate_of_change_cm_min = Column(Float, nullable=True)
    hsi_score = Column(Float, nullable=True)
    risk_level = Column(String(20), default="NORMAL")

class AlertModel(Base):
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(String(50), unique=True, index=True, nullable=False)
    source_node_id = Column(String(50), index=True, nullable=False)
    source_node_name = Column(String(100), nullable=False)
    affected_settlement_id = Column(String(50), nullable=False)
    affected_settlement_name = Column(String(100), nullable=False)
    eta_minutes = Column(Float, nullable=False)
    risk_level = Column(String(20), nullable=False)
    evacuation_zone = Column(String(255), nullable=True)
    population_at_risk = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    acknowledged = Column(Boolean, default=False)
