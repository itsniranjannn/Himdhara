import json
import math
import os
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
       Multi-factor score fusing continuous physical stage capacity (S_level),
       surge velocity (S_rate), and antecedent soil moisture saturation (S_soil):
       HSI = S_level + 0.5 * S_rate + S_soil
       
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
        self._load_default_thresholds()

    def _load_default_thresholds(self):
        """Auto-populates thresholds from river_topology.json as a fail-safe."""
        try:
            topo_path = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "..", "shared", "river_topology.json")
            )
            if os.path.exists(topo_path):
                with open(topo_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for n in data.get("nodes", []):
                        if "thresholds" in n:
                            self._node_thresholds[n["node_id"]] = n["thresholds"]
        except Exception as e:
            pass

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

        # 1. Baseline EMA from prior readings (expected level before current measurement)
        expected_baseline = self._ema_cache.get(node_id, water_level_cm)
        ema = (self.alpha * water_level_cm) + ((1.0 - self.alpha) * expected_baseline)
        self._ema_cache[node_id] = ema

        # 2. Compute Rate of Change (cm / minute) with smoothing over recent window
        rate_of_change = 0.0
        if node_window:
            prev_time, prev_reading = node_window[-1]
            dt_seconds = max(1.0, (timestamp - prev_time).total_seconds())
            dt_minutes = dt_seconds / 60.0
            instant_rate = (water_level_cm - prev_reading["water_level_cm"]) / dt_minutes
            
            # If 2 or more readings exist, blend 1-step and 2-step rate to avoid single-point jitter
            if len(node_window) >= 2:
                prev2_time, prev2_reading = node_window[-2]
                dt2_min = max(2.0, (timestamp - prev2_time).total_seconds()) / 60.0
                rate_2step = (water_level_cm - prev2_reading["water_level_cm"]) / dt2_min
                rate_of_change = (instant_rate * 0.7) + (rate_2step * 0.3)
            else:
                rate_of_change = instant_rate

        # Physical safety thresholds for this station
        thresholds = self._node_thresholds.get(node_id, {
            "water_level_watch": 100.0,
            "water_level_warning": 150.0,
            "water_level_critical": 200.0
        })
        t_watch = thresholds.get("water_level_watch", 100.0)
        t_warn = thresholds.get("water_level_warning", 150.0)
        t_crit = thresholds.get("water_level_critical", 200.0)

        # 3. Water Level Deviation from Baseline
        deviation = water_level_cm - expected_baseline

        # 4. Stage Stress Term (S_level): Continuous physical scale 0.0 to 3.5+
        # Grounded in physical flood capacity relative to Watch, Warning, and Critical levels
        if water_level_cm >= t_crit:
            # Over bankfull capacity: strictly 3.0+
            s_level = 3.0 + max(0.0, (water_level_cm - t_crit) / max(10.0, t_crit - t_warn))
        elif water_level_cm >= t_warn:
            # Warning zone: 2.0 to 3.0
            s_level = 2.0 + (water_level_cm - t_warn) / max(10.0, t_crit - t_warn)
        elif water_level_cm >= t_watch:
            # Watch zone: 1.0 to 2.0
            s_level = 1.0 + (water_level_cm - t_watch) / max(10.0, t_warn - t_watch)
        else:
            # Normal baseline zone: 0.0 to 1.0
            base_ref = max(10.0, t_watch * 0.5)
            s_level = max(0.0, min(1.0, (water_level_cm - base_ref) / max(10.0, t_watch - base_ref)))

        # 5. Surge Rate Term (S_rate): Dynamic surge bonus (normalized per 15 cm/min surge)
        if rate_of_change > 0:
            s_rate = min(2.5, rate_of_change / 12.0)
        else:
            s_rate = 0.0

        # 6. Soil Moisture Factor (S_soil): Amplifies runoff when soil is saturated (>40%)
        sat_threshold = settings.SOIL_MOISTURE_SAT_THRESHOLD
        if soil_moisture_pct > sat_threshold:
            s_soil = ((soil_moisture_pct - sat_threshold) / (100.0 - sat_threshold)) * 0.6
        else:
            s_soil = 0.0

        # 7. Composite Hydrological Stress Index (HSI) Synthesis
        # Scaled composite score: 0 to 5+
        # If water is at or above critical capacity, HSI is guaranteed to reflect critical status (>= 3.0)
        hsi = s_level + (0.5 * s_rate) + s_soil

        risk_level = "NORMAL"
        reasons = []

        # Decision tree combining physical safety limits and analytical stress
        if water_level_cm >= t_crit or hsi >= 3.0 or (water_level_cm >= t_warn and rate_of_change > 20.0):
            risk_level = "CRITICAL"
            if water_level_cm >= t_crit:
                reasons.append(f"Water level {water_level_cm:.1f}cm exceeded critical flood limit ({t_crit:.1f}cm)")
            if hsi >= 3.0:
                reasons.append(f"High Hydrological Stress Index ({hsi:.2f} >= 3.0)")
            if rate_of_change > 20.0:
                reasons.append(f"Dangerous flash surge rate ({rate_of_change:.1f} cm/min)")
        elif water_level_cm >= t_warn or hsi >= 2.0 or (water_level_cm >= t_watch and rate_of_change > 12.0):
            risk_level = "WARNING"
            if water_level_cm >= t_warn:
                reasons.append(f"Water level {water_level_cm:.1f}cm crossed warning limit ({t_warn:.1f}cm)")
            if hsi >= 2.0:
                reasons.append(f"Elevated Hydrological Stress Index ({hsi:.2f} >= 2.0)")
            if rate_of_change > 12.0:
                reasons.append(f"Surge rate accelerating ({rate_of_change:.1f} cm/min)")
        elif water_level_cm >= t_watch or hsi >= 1.2 or rate_of_change > 8.0 or soil_moisture_pct > 85.0:
            risk_level = "WATCH"
            if water_level_cm >= t_watch:
                reasons.append(f"Water level approaching watch limit ({t_watch:.1f}cm)")
            if hsi >= 1.2:
                reasons.append(f"Mild hydrological stress ({hsi:.2f} >= 1.2)")
            if soil_moisture_pct > 85.0:
                reasons.append(f"High soil moisture saturation ({soil_moisture_pct:.1f}%)")
        else:
            risk_level = "NORMAL"
            reasons.append("Hydrological parameters within nominal baseline")

        # Log raw mathematical breakdown for analytical verification
        if risk_level != "NORMAL" or rate_of_change > 5.0:
            print(
                f"[*] [ANOMALY LOG] {node_id} | Level: {water_level_cm:.1f}cm (Crit: {t_crit:.1f}cm) | "
                f"Dev: {deviation:+.1f}cm | Rate: {rate_of_change:+.2f}cm/min | Soil: {soil_moisture_pct:.1f}% | "
                f"Terms: [S_level={s_level:.2f}, S_rate={s_rate:.2f}, S_soil={s_soil:.2f}] => HSI: {hsi:.2f} [{risk_level}]",
                flush=True
            )

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
            "s_level": round(s_level, 2),
            "s_rate": round(s_rate, 2),
            "s_soil": round(s_soil, 2),
            "hsi_score": round(hsi, 2),
            "risk_level": risk_level,
            "reason": "; ".join(reasons),
            "timestamp": timestamp
        }

# Global singleton anomaly detector instance
anomaly_engine = AnomalyDetectionEngine()
