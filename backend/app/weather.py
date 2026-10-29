"""Rain outlook from Open-Meteo (free, no API key). Context for operators, not an input to the risk engine."""
import json
import time
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

API_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_SECONDS = 30 * 60
HOURS = 72

# Daily rainfall categories used by Nepal's DHM / IMD style bulletins (mm per 24 h).
LEVELS = [(115.5, "VERY_HEAVY"), (64.5, "HEAVY"), (15.6, "MODERATE"), (0.0, "LOW")]

_cache: Dict[str, tuple] = {}


def classify(mm_24h: float) -> str:
    for floor, label in LEVELS:
        if mm_24h >= floor:
            return label
    return "LOW"


def summarize(hourly_mm: List[Optional[float]]) -> dict:
    values = [float(v or 0.0) for v in hourly_mm[:HOURS]]
    first_day = values[:24]
    return {
        "next_24h_mm": round(sum(first_day), 1),
        "next_72h_mm": round(sum(values), 1),
        "peak_hour_mm": round(max(values) if values else 0.0, 1),
        "level": classify(sum(first_day)),
        "hourly_mm": [round(v, 2) for v in first_day],
    }


def fetch_outlook(stations: List[dict], fetcher=None) -> List[dict]:
    """One Open-Meteo request for all stations of a basin. `fetcher(url)` is injectable for tests."""
    query = urllib.parse.urlencode({
        "latitude": ",".join(str(s["lat"]) for s in stations),
        "longitude": ",".join(str(s["lng"]) for s in stations),
        "hourly": "precipitation", "forecast_hours": HOURS, "timezone": "Asia/Kathmandu",
    })
    url = f"{API_URL}?{query}"
    if fetcher is None:
        def fetcher(target):
            with urllib.request.urlopen(target, timeout=8) as response:
                return json.loads(response.read().decode())
    payload = fetcher(url)
    payload = payload if isinstance(payload, list) else [payload]
    if len(payload) != len(stations):
        raise ValueError("unexpected Open-Meteo response size")
    return [{"node_id": s["node_id"], "name": s["name"], **summarize(item["hourly"]["precipitation"])}
            for s, item in zip(stations, payload)]


def basin_outlook(basin_id: str, stations: List[dict], fetcher=None, now: Optional[float] = None) -> dict:
    """Cached per basin. Never raises: an unreachable service yields status UNAVAILABLE."""
    now = time.time() if now is None else now
    cached = _cache.get(basin_id)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        stations_out = fetch_outlook(stations, fetcher)
        result = {
            "status": "OK", "source": "Open-Meteo", "fetched_at": now,
            "level": max((s["level"] for s in stations_out), key=[l for _, l in reversed(LEVELS)].index),
            "stations": stations_out,
        }
        _cache[basin_id] = (now, result)
        return result
    except Exception as error:
        if cached:  # keep serving the last good forecast, flagged as stale
            return {**cached[1], "status": "STALE", "error": str(error)[:160]}
        return {"status": "UNAVAILABLE", "source": "Open-Meteo", "error": str(error)[:160], "stations": []}


def clear_cache() -> None:
    _cache.clear()
