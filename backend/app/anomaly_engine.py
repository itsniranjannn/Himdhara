import math
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Optional
from .config import settings

class AnomalyDetectionEngine:
    """
    Module C: Custom Analytical Anomaly & Hydrological Risk Engine
    --------------------------------------------------------------
    Designed from foundational mathematical principles without black-box ML:
    
    1. Rolling Baseline (EMA):
       Maintains an Exponential Moving Average of water levels:
       EMA_t = alpha * L_t + (1 - alpha) * EMA_{t-1}
       where alpha = 2 / (N + 1) for window size N (default 12 readings).
       
    2. Dynamic Rate of Change:
       Computes the velocity of water level surge:
       d_rate = (L_t - L_{t-1}) / delta_minutes
       
    3. Hydrological Stress Index (HSI):
       Multi-factor score fusing water level deviation, rate of change,
       and soil saturation thresholding:
       HSI = w_dev * (L_t - EMA) / sigma + w_rate * max(0, d_rate) + w_soil * soil_factor
       
    4. Deterministic Risk Classification:
       Classifies into NORMAL, WATCH, WARNING, CRITICAL based on calibrated
       thresholds and physical bankfull safety limits.
    """

    def __init__(self, window_size: int = 12):
        self.window_size = window_size
        self.alpha = 2.0 / (window_size + 1)
        
        # Per-node historical window: {node_id: deque of (timestamp, reading_dict)}
        self._history: Dict[str, deque] = {}
        # Per-node baseline EMA cache
        self._ema_cache: Dict[str, float] = {}
        # Thresholds per node (loaded from river topology)
        self._node_thresholds: Dict[str, Dict[str, float]] = {}

    def set_node_thresholds(self, node_id: str, thresholds: Dict[str, float]):
        """Sets physical safety thresholds (watch, warning, critical) for a specific node."""
        self._node_thresholds[node_id] = thresholds

    def process_reading(
        self,
        node_id: str,
        water_level_cm: float,
        rainfall_mm: float,
        soil_moisture_pct: float,
        timestamp: Optional[datetime] = None
    ) -> Dict[str, any]:
        """
        Ingests a single reading, updates the rolling mathematical state,
        and returns computed analytical metrics with risk classification.
        """
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)

        if node_id not in self._history:
            self._history[node_id] = deque(maxlen=self.window_size)

        node_window = self._history[node_id]

        # 1. Compute EMA Baseline
        if node_id not in self._ema_cache or not node_window:
            ema = water_level_cm
        else:
            prev_ema = self._ema_cache[node_id]
            ema = (self.alpha * water_level_cm) + ((1.0 - self.alpha) * prev_ema)
        self._ema_cache[node_id] = ema

        # 2. Compute Rate of Change (cm / minute)
        rate_of_change = 0.0
        if node_window:
            prev_time, prev_reading = node_window[-1]
            dt_seconds = max(1.0, (timestamp - prev_time).total_seconds())
            dt_minutes = dt_seconds / 60.0
            rate_of_change = (water_level_cm - prev_reading["water_level_cm"]) / dt_minutes

        # 3. Compute Rolling Standard Deviation of Water Level in Window
        all_levels = [item[1]["water_level_cm"] for item in node_window] + [water_level_cm]
        mean_level = sum(all_levels) / len(all_levels)
        variance = sum((x - mean_level) ** 2 for x in all_levels) / len(all_levels)
        std_dev = math.sqrt(variance)
        # Avoid division by zero: minimum baseline standard deviation is 2.5 cm
        effective_std = max(2.5, std_dev)

        # 4. Water Level Deviation Score (Z-Score analogue relative to dynamic EMA)
        deviation = water_level_cm - ema
        dev_score = max(0.0, deviation / effective_std)

        # 5. Soil Moisture Factor (Soil saturation amplifies surface runoff)
        # Saturated ground cannot absorb rainfall, leading to rapid flash flooding
        sat_threshold = settings.SOIL_MOISTURE_SAT_THRESHOLD
        if soil_moisture_pct > sat_threshold:
            soil_factor = (soil_moisture_pct - sat_threshold) / (100.0 - sat_threshold)
        else:
            soil_factor = 0.0

        # 6. Hydrological Stress Index (HSI) Synthesis
        # Scaled composite score: 0 to 5+
        w_dev = settings.WATER_DEV_WEIGHT
        w_rate = settings.RATE_OF_CHANGE_WEIGHT
        w_soil = settings.SOIL_MOISTURE_WEIGHT

        # Rate of change component scaled (normalized per 10 cm/min surge)
        norm_rate = max(0.0, rate_of_change / 10.0)

        hsi = (w_dev * dev_score) + (w_rate * norm_rate * 3.0) + (w_soil * soil_factor * 2.0)

        # 7. Discrete Risk Level Classification
        thresholds = self._node_thresholds.get(node_id, {
            "water_level_watch": 100.0,
            "water_level_warning": 150.0,
            "water_level_critical": 200.0
        })

        t_watch = thresholds.get("water_level_watch", 100.0)
        t_warn = thresholds.get("water_level_warning", 150.0)
        t_crit = thresholds.get("water_level_critical", 200.0)

        risk_level = "NORMAL"
        reasons = []

        # Classification decision hierarchy combining physical limits and analytical stress
        if water_level_cm >= t_crit or hsi >= 3.0 or (water_level_cm >= t_warn and rate_of_change > 25.0):
            risk_level = "CRITICAL"
            if water_level_cm >= t_crit:
                reasons.append(f"Water level {water_level_cm:.1f}cm crossed critical limit ({t_crit:.1f}cm)")
            if hsi >= 3.0:
                reasons.append(f"High Hydrological Stress Index ({hsi:.2f} >= 3.0)")
            if rate_of_change > 25.0:
                reasons.append(f"Rapid surge rate ({rate_of_change:.1f} cm/min)")
        elif water_level_cm >= t_warn or hsi >= 2.0 or (water_level_cm >= t_watch and rate_of_change > 15.0):
            risk_level = "WARNING"
            if water_level_cm >= t_warn:
                reasons.append(f"Water level {water_level_cm:.1f}cm crossed warning limit ({t_warn:.1f}cm)")
            if hsi >= 2.0:
                reasons.append(f"Moderate Hydrological Stress Index ({hsi:.2f} >= 2.0)")
            if rate_of_change > 15.0:
                reasons.append(f"Surge rate accelerating ({rate_of_change:.1f} cm/min)")
        elif water_level_cm >= t_watch or hsi >= 1.2 or (rate_of_change > 10.0 and water_level_cm > t_watch * 0.7) or soil_moisture_pct > 85.0:
            risk_level = "WATCH"
            if water_level_cm >= t_watch:
                reasons.append(f"Water level approaching watch limit ({t_watch:.1f}cm)")
            if hsi >= 1.2:
                reasons.append(f"Mild stress index ({hsi:.2f} >= 1.2)")
            if soil_moisture_pct > 85.0:
                reasons.append(f"High soil moisture saturation ({soil_moisture_pct:.1f}%)")
        else:
            risk_level = "NORMAL"
            reasons.append("Parameters within baseline hydrological boundaries")

        # Update node window
        reading_record = {
            "water_level_cm": water_level_cm,
            "rainfall_mm": rainfall_mm,
            "soil_moisture_pct": soil_moisture_pct
        }
        node_window.append((timestamp, reading_record))

        return {
            "node_id": node_id,
            "water_level_cm": round(water_level_cm, 2),
            "rainfall_mm": round(rainfall_mm, 2),
            "soil_moisture_pct": round(soil_moisture_pct, 2),
            "ema_water_level": round(ema, 2),
            "rate_of_change_cm_min": round(rate_of_change, 2),
            "hsi_score": round(hsi, 2),
            "risk_level": risk_level,
            "reason": "; ".join(reasons),
            "timestamp": timestamp
        }

# Global singleton anomaly detector instance
anomaly_engine = AnomalyDetectionEngine()
