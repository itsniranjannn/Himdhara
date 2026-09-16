from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class TelemetryPayload(BaseModel):
    node_id: str
    rainfall_mm: float
    water_level_cm: float
    soil_moisture_pct: float
    timestamp: Optional[datetime] = None

class ComputedMetrics(BaseModel):
    ema_water_level: float
    rate_of_change_cm_min: float
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

class NodeStatus(BaseModel):
    node_id: str
    name: str
    node_type: str
    elevation_m: float
    lat: float
    lng: float
    description: Optional[str] = None
    current_risk: str
    latest_reading: Optional[Dict[str, Any]] = None
    thresholds: Optional[Dict[str, float]] = None

class SpikeInjectionRequest(BaseModel):
    node_id: str
    water_level_surge_cm: float = 120.0
    rainfall_surge_mm: float = 65.0
    soil_moisture_surge_pct: float = 35.0
    duration_seconds: int = 45
