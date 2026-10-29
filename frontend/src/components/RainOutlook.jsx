import React from "react";
import { CloudRain, CloudOff } from "lucide-react";
import { Loading } from "./ui";

const LEVEL_TEXT = { LOW: "Light or no rain", MODERATE: "Moderate rain", HEAVY: "Heavy rain", VERY_HEAVY: "Very heavy rain" };

// Rain forecast for the stations of a basin. Free data from Open-Meteo (CC BY 4.0, attribution required).
// It is context for operators; it does not feed the risk engine.
export default function RainOutlook({ weather, title = "Rain outlook · next 72 hours" }) {
  if (!weather) return <section className="panel outlook-panel"><div className="panel-title-row"><h2><CloudRain size={15} /> {title}</h2></div><Loading label="Loading forecast…" /></section>;
  if (weather.status === "UNAVAILABLE") {
    return <section className="panel outlook-panel"><div className="panel-title-row"><h2><CloudRain size={15} /> {title}</h2></div><div className="empty-state"><CloudOff size={18} /><span>Rain forecast unavailable right now. River levels and alerts are not affected.</span></div></section>;
  }
  return <section className="panel outlook-panel">
    <div className="panel-title-row"><h2><CloudRain size={15} /> {title}</h2><span>{weather.status === "STALE" ? "Showing last forecast" : "Updated every 30 min"}</span></div>
    <div className="outlook-head"><span className={`rain-badge ${weather.level}`}>{LEVEL_TEXT[weather.level] || weather.level}</span><span className="muted">Highest 24 h total across the basin&apos;s stations</span></div>
    <div className="outlook-grid">
      {weather.stations.map((station) => {
        const peak = Math.max(...station.hourly_mm, 0.1);
        return <div className="outlook-card" key={station.node_id}>
          <strong>{station.name}</strong>
          <span className="mm">{station.next_24h_mm} mm</span> <small>next 24 h · {station.next_72h_mm} mm in 72 h</small>
          <div className="rain-bars" role="img" aria-label={`Hourly rain for the next 24 hours, peak ${station.peak_hour_mm} millimetres per hour`}>
            {station.hourly_mm.map((mm, index) => <span key={index} style={{ height: `${Math.max((mm / peak) * 100, 6)}%` }} title={`+${index + 1} h: ${mm} mm`} />)}
          </div>
        </div>;
      })}
    </div>
    <p className="attribution">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0). Forecast guidance only; river alerts come from station readings.</p>
  </section>;
}
