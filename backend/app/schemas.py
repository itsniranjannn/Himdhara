from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
try:
    from pydantic import model_validator
except ImportError:  # Pydantic 1.x compatibility
    model_validator = None

class TelemetryPayload(BaseModel):
    node_id: str
    rainfall_mm: float
    water_level_cm: float
    soil_moisture_pct: float
    timestamp: Optional[datetime] = None

class ComputedMetrics(BaseModel):
    ema_water_level: float
    rate_of_change_cm_min: float
    s_level: float
    s_rate: float
    s_soil: float
    hsi_score: float
    risk_level: str  # NORMAL, WATCH, WARNING, CRITICAL
    reason: str

class ProcessedReading(TelemetryPayload):
    metrics: ComputedMetrics

class SettlementAlert(BaseModel):
    alert_id: str
    source_node_id: str
    source_node_name: str
    affected_settlement_id: str
    affected_settlement_name: str
    eta_minutes: float
    risk_level: str
    evacuation_zone: Optional[str] = None
    population_at_risk: int = 0
    created_at: datetime
    acknowledged: bool = False
    status: str = "ACTIVE"

class NodeStatus(BaseModel):
    node_id: str
    basin_id: str = "trishuli"
    name: str
    node_type: str
    elevation_m: float
    lat: float
    lng: float
    description: Optional[str] = None
    current_risk: str
    last_reading_at: Optional[datetime] = None
    latest_reading: Optional[Dict[str, Any]] = None
    thresholds: Optional[Dict[str, float]] = None

class SpikeInjectionRequest(BaseModel):
    node_id: str
    water_level_surge_cm: float = Field(default=120.0, ge=0, le=300)
    rainfall_surge_mm: float = Field(default=65.0, ge=0, le=200)
    soil_moisture_surge_pct: float = Field(default=35.0, ge=0, le=60)
    duration_seconds: int = Field(default=45, ge=10, le=300)

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)

class NewUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=10, max_length=200)
    role: str = "viewer"

class ContactCreate(BaseModel):
    settlement_id: str
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=150)
    language: str = Field(default="en", pattern="^(en|ne)$")

class PublicSubscribe(BaseModel):
    settlement_id: str
    email: str = Field(max_length=150)
    language: str = Field(default="en", pattern="^(en|ne)$")

class AlertTransitionRequest(BaseModel):
    note: Optional[str] = None

class ThresholdUpdate(BaseModel):
    water_level_watch: float = Field(gt=0)
    water_level_warning: float = Field(gt=0)
    water_level_critical: float = Field(gt=0)

    if model_validator:
        @model_validator(mode="after")
        def validate_order(self):
            if not (self.water_level_watch < self.water_level_warning < self.water_level_critical):
                raise ValueError("thresholds must be strictly ordered: watch < warning < critical")
            return self
    else:
        from pydantic import root_validator
        @root_validator(skip_on_failure=True)
        def validate_order(cls, values):
            if not (values.get("water_level_watch", 0) < values.get("water_level_warning", 0) < values.get("water_level_critical", 0)):
                raise ValueError("thresholds must be strictly ordered: watch < warning < critical")
            return values

class SettlementUpdate(BaseModel):
    name: Optional[str] = None
    evacuation_zone: Optional[str] = None
    population: Optional[int] = Field(default=None, ge=0)
