import React, { useEffect, useState } from "react";
import { Waves, CloudOff, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Loading } from "./ui";
import { fetchFlow } from "../services/api";

const TREND = { RISING: ["Rising", TrendingUp], FALLING: ["Falling", TrendingDown], STEADY: ["Steady", Minus] };
const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));

function Spark({ series }) {
  const max = Math.max(...series, 0.1), min = Math.min(...series);
  const span = Math.max(max - min, max * 0.05, 0.1);
  const point = (v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / span) * 24}`;
  const today = 7;
  return <svg className="flow-spark" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Discharge for the past 7 days and the next 7 days">
    <polyline points={series.map(point).join(" ")} fill="none" stroke="var(--brand)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    <line x1={(today / (series.length - 1)) * 100} x2={(today / (series.length - 1)) * 100} y1="0" y2="32" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

// Modelled river discharge near each station (GloFAS via Open-Meteo, CC BY 4.0). A real-world reference
// beside the simulated station readings; it is a 5 km model, not a gauge, and never feeds the risk engine.
export default function RiverFlow({ basinId }) {
  const [state, setState] = useState({ id: null, data: null });
  useEffect(() => {
    let active = true;
    fetchFlow(basinId).then((data) => active && setState({ id: basinId, data })).catch(() => active && setState({ id: basinId, data: { status: "UNAVAILABLE", stations: [] } }));
    return () => { active = false; };
  }, [basinId]);
  const flow = state.id === basinId ? state.data : null;
  const title = "River flow · real-world reference";
  if (!flow) return <section className="panel outlook-panel"><div className="panel-title-row"><h2><Waves size={15} /> {title}</h2></div><Loading label="Loading river model…" /></section>;
  if (flow.status === "UNAVAILABLE" || !flow.stations.length) {
    return <section className="panel outlook-panel"><div className="panel-title-row"><h2><Waves size={15} /> {title}</h2></div><div className="empty-state"><CloudOff size={18} /><span>River model unavailable right now. Station readings and alerts are not affected.</span></div></section>;
  }
  return <section className="panel outlook-panel">
    <div className="panel-title-row"><h2><Waves size={15} /> {title}</h2><span>{flow.status === "STALE" ? "Showing last model run" : "Daily model, refreshed every 3 h"}</span></div>
    <p className="muted small flow-note">Modelled discharge in m³/s for the 7 days behind and 7 days ahead. The dashed line is today. Station readings above are simulated; this is the real river as a satellite-driven model sees it.</p>
    <div className="outlook-grid">
      {flow.stations.map((station) => {
        if (station.trend === "NO_DATA") return <div className="outlook-card" key={station.node_id}><strong>{station.name}</strong><small>No model data for this location</small></div>;
        const [label, Icon] = TREND[station.trend] || TREND.STEADY;
        return <div className="outlook-card" key={station.node_id}>
          <strong>{station.name}</strong>
          <span className="mm">{fmt(station.today_m3s)} m³/s</span> <small className={`flow-trend ${station.trend}`}><Icon size={12} /> {label} {station.change_pct > 0 ? "+" : ""}{station.change_pct}% in 7 days</small>
          <Spark series={station.series_m3s} />
          <small>Next 7 days peak {fmt(station.next_7d_peak_m3s)} m³/s</small>
        </div>;
      })}
    </div>
    <p className="attribution">Flood data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (GloFAS, CC BY 4.0). Small streams are under-resolved by a 5 km model.</p>
  </section>;
}
