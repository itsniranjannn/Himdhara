"""Read-side analytics: trend forecast and historical summaries."""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

MAX_HORIZON_MIN = 180.0
MIN_POINTS = 5
STEADY_BAND_CM_MIN = 0.5


def linear_trend(points: Sequence[Tuple[float, float]]) -> Optional[Tuple[float, float, float]]:
    """Least-squares fit over (minutes, level). Returns (slope, intercept, r_squared)."""
    n = len(points)
    if n < 2:
        return None
    mean_x = sum(p[0] for p in points) / n
    mean_y = sum(p[1] for p in points) / n
    sxx = sum((p[0] - mean_x) ** 2 for p in points)
    if sxx == 0:
        return None
    sxy = sum((p[0] - mean_x) * (p[1] - mean_y) for p in points)
    syy = sum((p[1] - mean_y) ** 2 for p in points)
    slope = sxy / sxx
    r2 = 1.0 if syy == 0 else (sxy * sxy) / (sxx * syy)
    return slope, mean_y - slope * mean_x, r2


def forecast(readings: Sequence[Tuple[datetime, float]], thresholds: Dict[str, float]) -> Dict:
    """Project minutes until each water-level threshold is reached, from the recent linear trend.

    `readings` are (timestamp, water_level_cm), oldest first. This is a short-horizon
    extrapolation to support operator judgement; it is not a hydrological model.
    """
    if len(readings) < MIN_POINTS:
        return {"status": "INSUFFICIENT_DATA", "points": len(readings), "horizon_min": MAX_HORIZON_MIN}
    t0 = readings[0][0]
    points = [((ts - t0).total_seconds() / 60.0, level) for ts, level in readings]
    fit = linear_trend(points)
    current = readings[-1][1]
    if not fit:
        return {"status": "INSUFFICIENT_DATA", "points": len(readings), "horizon_min": MAX_HORIZON_MIN}
    slope, _, r2 = fit
    trend = "RISING" if slope > STEADY_BAND_CM_MIN else "FALLING" if slope < -STEADY_BAND_CM_MIN else "STEADY"
    projections = {}
    for name in ("watch", "warning", "critical"):
        limit = thresholds.get(f"water_level_{name}")
        if limit is None:
            continue
        if current >= limit:
            projections[name] = 0.0
        elif trend == "RISING":
            minutes = (limit - current) / slope
            projections[name] = round(minutes, 1) if minutes <= MAX_HORIZON_MIN else None
        else:
            projections[name] = None
    return {
        "status": "OK", "trend": trend, "points": len(readings),
        "window_min": round(points[-1][0], 1), "current_cm": round(current, 2),
        "slope_cm_min": round(slope, 3), "confidence": round(r2, 2),
        "minutes_to": projections, "horizon_min": MAX_HORIZON_MIN,
    }


def downsample(rows: List, max_points: int) -> List:
    """Keep at most max_points evenly spaced rows (always including the newest)."""
    if max_points <= 0 or len(rows) <= max_points:
        return rows
    step = len(rows) / max_points
    picked = [rows[int(i * step)] for i in range(max_points - 1)]
    picked.append(rows[-1])
    return picked


def window_start(hours: float) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
