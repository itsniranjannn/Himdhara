from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, Index
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
    s_level = Column(Float, nullable=True)
    s_rate = Column(Float, nullable=True)
    s_soil = Column(Float, nullable=True)
    hsi_score = Column(Float, nullable=True)
    risk_level = Column(String(20), default="NORMAL")

    __table_args__ = (Index("ix_readings_node_time", "node_id", "timestamp"),)

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
    status = Column(String(20), default="ACTIVE", nullable=False)
    acknowledged_at = Column(DateTime, nullable=True)
    acknowledged_by = Column(String(100), nullable=True)
    acknowledgment_note = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(100), nullable=True)

    __table_args__ = (
        Index(
            "uq_open_alert_source_settlement",
            "source_node_id",
            "affected_settlement_id",
            unique=True,
            sqlite_where=(status.in_(["ACTIVE", "ACKNOWLEDGED"])),
            postgresql_where=(status.in_(["ACTIVE", "ACKNOWLEDGED"])),
        ),
    )

class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class AlertHistoryModel(Base):
    __tablename__ = "alert_history"
    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(String(50), index=True, nullable=False)
    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=False)
    changed_by = Column(String(100), nullable=True)
    note = Column(Text, nullable=True)
    changed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

class IncidentModel(Base):
    __tablename__ = "incidents"
    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(String(60), unique=True, index=True, nullable=False)
    source_node_id = Column(String(50), index=True, nullable=False)
    peak_risk = Column(String(20), nullable=False)
    started_at = Column(DateTime, nullable=False)
    recovered_at = Column(DateTime, nullable=True)
    recovery_note = Column(Text, nullable=True)

class SettlementModel(Base):
    __tablename__ = "settlements"
    id = Column(Integer, primary_key=True, index=True)
    settlement_id = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    evacuation_zone = Column(String(255), nullable=True)
    population = Column(Integer, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ContactModel(Base):
    """A person or office that receives alerts for a settlement."""
    __tablename__ = "contacts"
    id = Column(Integer, primary_key=True, index=True)
    settlement_id = Column(String(50), index=True, nullable=False)
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=True)
    email = Column(String(150), nullable=True)
    language = Column(String(5), default="en")  # 'en' or 'ne'
    active = Column(Boolean, default=True)
    source = Column(String(20), default="operator")  # 'operator' or 'public'
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class NotificationModel(Base):
    """Persistent delivery log for every SMS or email the system sends."""
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    alert_id = Column(String(50), index=True, nullable=True)
    channel = Column(String(10), nullable=False)
    provider = Column(String(20), nullable=False)
    recipient = Column(String(150), nullable=False)
    content = Column(Text, nullable=False)
    status = Column(String(12), nullable=False, default="SENT")  # SENT, SIMULATED, FAILED
    error = Column(Text, nullable=True)
