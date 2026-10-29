"""Modelled river discharge from the GloFAS flood model through Open-Meteo (free, no API key).

A real-world reference for operators, shown beside the simulated station readings. It is a 5 km
gridded model, not a gauge, so small streams are under-resolved. To find the main channel near a
station we sample a 3x3 block of cells and keep the one carrying the most water. It does not feed
the risk engine.
"""
import json
import time
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

API_URL = "https://flood-api.open-meteo.com/v1/flood"
CACHE_SECONDS = 3 * 60 * 60
PAST_DAYS = 7
FORECAST_DAYS = 7
STEP = 0.05  # degrees, the model's grid spacing

_cache: Dict[str, tuple] = {}


def _block(lat: float, lng: float) -> List[tuple]:
    return [(round(lat + dy * STEP, 4), round(lng + dx * STEP, 4)) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def _pick_main_channel(cells: List[dict]) -> Optional[List[float]]:
    """The cell with the highest mean discharge is the main channel; None when the model has no data."""
    best, best_mean = None, -1.0
    for cell in cells:
        series = cell.get("daily", {}).get("river_discharge") or []
        values = [v for v in series if v is not None]
        if len(values) < PAST_DAYS + 1:
            continue
        mean = sum(values) / len(values)
        if mean > best_mean:
            best, best_mean = [float(v) if v is not None else 0.0 for v in series], mean
    return best


def summarize(series: List[float]) -> dict:
    today = series[PAST_DAYS]
    week_ago = series[0]
    upcoming = series[PAST_DAYS + 1:]
    change = ((today - week_ago) / week_ago * 100.0) if week_ago > 0 else 0.0
    peak = max(upcoming) if upcoming else today
    trend = "RISING" if change > 10 else "FALLING" if change < -10 else "STEADY"
    return {"today_m3s": round(today, 1), "week_ago_m3s": round(week_ago, 1), "change_pct": round(change, 1), "trend": trend,
            "next_7d_peak_m3s": round(peak, 1), "series_m3s": [round(v, 1) for v in series]}


def fetch_flow(stations: List[dict], fetcher=None) -> List[dict]:
    coords = [c for s in stations for c in _block(s["lat"], s["lng"])]
    query = urllib.parse.urlencode({
        "latitude": ",".join(f"{c[0]:.4f}" for c in coords), "longitude": ",".join(f"{c[1]:.4f}" for c in coords),
        "daily": "river_discharge", "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS,
    })
    url = f"{API_URL}?{query}"
    if fetcher is None:
        def fetcher(target):
            with urllib.request.urlopen(target, timeout=12) as response:
                return json.loads(response.read().decode())
    payload = fetcher(url)
    payload = payload if isinstance(payload, list) else [payload]
    if len(payload) != len(coords):
        raise ValueError("unexpected flood API response size")
    out = []
    for index, station in enumerate(stations):
        series = _pick_main_channel(payload[index * 9:(index + 1) * 9])
        out.append({"node_id": station["node_id"], "name": station["name"], **(summarize(series) if series else {"trend": "NO_DATA"})})
    return out


def basin_flow(basin_id: str, stations: List[dict], fetcher=None, now: Optional[float] = None) -> dict:
    """Cached per basin. Never raises: an unreachable service yields status UNAVAILABLE."""
    now = time.time() if now is None else now
    cached = _cache.get(basin_id)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        result = {"status": "OK", "source": "GloFAS via Open-Meteo", "fetched_at": now, "stations": fetch_flow(stations, fetcher)}
        _cache[basin_id] = (now, result)
        return result
    except Exception as error:
        if cached:
            return {**cached[1], "status": "STALE", "error": str(error)[:160]}
        return {"status": "UNAVAILABLE", "source": "GloFAS via Open-Meteo", "error": str(error)[:160], "stations": []}


def clear_cache() -> None:
    _cache.clear()
