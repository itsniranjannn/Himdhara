import React, { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CheckCircle2, CircleAlert, Minus, WifiOff } from "lucide-react";
import RiverMap from "../components/RiverMap";
import LineChart from "../components/LineChart";
import RainOutlook from "../components/RainOutlook";
import { EmptyState, Loading, RiskLabel, Stat } from "../components/ui";
import { RISK_RANK, formatClock, lastSeen, parseUtc, riskOf, timeAgo, toNumber } from "../lib/format";

const NO_READINGS = [];
const METRICS = {
  water: { label: "Water", field: "water_level_cm", unit: "cm" },
  rate: { label: "Rate", field: "rate_of_change_cm_min", unit: "cm/min" },
  hsi: { label: "HSI", field: "hsi_score", unit: "" },
};

function Sparkline({ values }) {
  if (values.length < 2) return <span className="mini-line empty" aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, 1);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 60},${28 - ((v - min) / span) * 24}`).join(" ");
  return <svg className="mini-line" viewBox="0 0 60 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function ForecastStrip({ forecast }) {
  if (!forecast) return null;
  if (forecast.status !== "OK") return <p className="forecast muted">Trend forecast needs a few more readings.</p>;
  const { trend, slope_cm_min: slope, minutes_to: minutes, confidence } = forecast;
  const Icon = trend === "RISING" ? ArrowUpRight : trend === "FALLING" ? ArrowDownRight : Minus;
  const levels = [["watch", "Watch"], ["warning", "Warning"], ["critical", "Critical"]];
  // Levels already exceeded are always reported; future crossings only make sense on a rising trend.
  const chips = levels.filter(([key]) => minutes[key] === 0 || (trend === "RISING" && minutes[key] !== null && minutes[key] !== undefined));
  return <div className={`forecast ${trend.toLowerCase()}`}>
    <span className="forecast-trend"><Icon size={14} /> {trend === "STEADY" ? "Steady" : trend === "RISING" ? "Rising" : "Falling"} {slope > 0 ? "+" : ""}{slope} cm/min</span>
    {chips.length > 0
      ? chips.map(([key, label]) => <span key={key} className={`forecast-chip ${key}`}>{minutes[key] === 0 ? `${label} level reached` : `${label} in ~${Math.round(minutes[key])} min`}</span>)
      : <span className="forecast-chip none">{trend === "RISING" ? "No threshold within 3 h at this rate" : "No threshold expected"}</span>}
    <small>Linear trend of the last readings · confidence {Math.round(confidence * 100)}% · guidance only</small>
  </div>;
}

export default function MonitorPage({ nodes, loaded, basin, topology, live, history, selectedId, onSelect, stats, openAlerts, forecast, weather, theme, now, staleSeconds, navigate }) {
  const [metric, setMetric] = useState("water");
  const station = nodes.find((node) => node.node_id === selectedId) || nodes[0];
  const stationRisk = station ? riskOf(station, live, now, staleSeconds) : "STALE";
  const current = station ? (live[station.node_id] || station.latest_reading || {}) : {};
  const readings = (station && history[station.node_id]) || NO_READINGS;
  const risks = nodes.map((node) => riskOf(node, live, now, staleSeconds));
  const sortedAlerts = useMemo(() => [...openAlerts].sort((a, b) => a.eta_minutes - b.eta_minutes), [openAlerts]);
  const meta = METRICS[metric];
  const points = useMemo(() => readings.slice(-90).map((r) => ({ t: parseUtc(r.timestamp)?.getTime(), v: Number(r[meta.field]) })).filter((p) => p.t && Number.isFinite(p.v)), [readings, meta.field]);
  const auditRows = [...readings].slice(-8).reverse();

  if (!loaded) return <div className="page"><Loading label="Loading stations…" /></div>;
  if (!nodes.length || !station) return <div className="page"><EmptyState icon={WifiOff}>No stations are registered for this basin yet. Start the backend and simulator.</EmptyState></div>;

  return <div className="page monitor-page">
    <div className="stats-grid">
      <Stat value={risks.filter((r) => r === "CRITICAL").length} label="Critical stations" tone={risks.includes("CRITICAL") ? "critical" : ""} />
      <Stat value={risks.filter((r) => r === "WARNING").length} label="Warning stations" tone={risks.includes("WARNING") ? "warning" : ""} />
      <Stat value={openAlerts.length} label="Open settlement alerts" tone={openAlerts.length ? "warning" : ""} />
      <Stat value={stats ? stats.total_readings.toLocaleString() : "—"} label="Readings stored (all basins)" />
    </div>
    {risks.includes("STALE") && <p className="stale-notice"><WifiOff size={14} /> {risks.filter((r) => r === "STALE").length} station(s) offline: no reading for over {staleSeconds}s.</p>}
    <div className="monitor-grid">
      <section className="panel map-panel"><div className="panel-title-row"><h2>Station network</h2><span>Select a marker or station row</span></div>
        <RiverMap key={basin?.basin_id} theme={theme} nodes={nodes} settlements={topology?.settlements || []} topology={topology} selectedNodeId={station.node_id} onSelectNode={onSelect} latestTelemetryMap={live} riskFor={(node) => riskOf(node, live, now, staleSeconds)} />
      </section>
      <section className="panel settlement-panel"><div className="panel-title-row"><h2>Settlement alerts</h2><span>{sortedAlerts.length}</span></div>
        {sortedAlerts.length
          ? <div className="small-alert-list">{sortedAlerts.slice(0, 6).map((alert) => <button className="small-alert" key={alert.alert_id} onClick={() => navigate("/app/alerts")}><CircleAlert size={15} /><span>{alert.affected_settlement_name}</span><b>{alert.eta_minutes} min</b></button>)}</div>
          : <EmptyState>No active alerts</EmptyState>}
        <p className="panel-foot"><i /> Sorted by flood-wave arrival time {sortedAlerts.length > 6 && <button className="link-button" onClick={() => navigate("/app/alerts")}>View all <ArrowRight size={12} /></button>}</p>
      </section>
    </div>
    <section className="panel telemetry-panel">
      <div className="panel-title-row"><h2><Activity size={15} /> {station.name}</h2><RiskLabel risk={stationRisk} /></div>
      <div className="tabs" role="tablist" aria-label="Metric">{Object.entries(METRICS).map(([key, item]) => <button key={key} role="tab" aria-selected={metric === key} className={metric === key ? "selected" : ""} onClick={() => setMetric(key)}>{item.label}</button>)}</div>
      <div className="telemetry-meta">
        <span>Water <b>{toNumber(current.water_level_cm)} cm</b></span>
        <span>Rate <b>{toNumber(current.rate_of_change_cm_min)} cm/min</b></span>
        <span>HSI <b>{toNumber(current.hsi_score)}</b></span>
        <span>Rain <b>{toNumber(current.rainfall_mm, 1)} mm</b></span>
        <span>Soil <b>{toNumber(current.soil_moisture_pct, 1)} %</b></span>
        <span title="Level, rate and soil components of the Hydrological Stress Index">Components <b>L {toNumber(current.s_level)} · R {toNumber(current.s_rate)} · S {toNumber(current.s_soil)}</b></span>
      </div>
      <p className="risk-reason">{stationRisk === "STALE" ? "No recent reading: this station is offline, so its risk cannot be assessed." : current.reason || "Waiting for the first reading."}</p>
      <LineChart points={points} thresholds={metric === "water" ? station.thresholds : {}} unit={meta.unit} showThresholds={metric === "water"} ariaLabel={`${station.name} ${meta.label} over time`} />
      <ForecastStrip forecast={forecast} />
    </section>
    <RainOutlook weather={weather} />
    <section className="panel station-panel"><div className="panel-title-row"><h2>Station status</h2><span>{nodes.length} stations</span></div>
      {[...nodes].sort((a, b) => RISK_RANK[riskOf(b, live, now, staleSeconds)] - RISK_RANK[riskOf(a, live, now, staleSeconds)] || a.name.localeCompare(b.name)).map((node) => {
        const risk = riskOf(node, live, now, staleSeconds);
        const level = live[node.node_id]?.water_level_cm ?? node.latest_reading?.water_level_cm;
        const seen = lastSeen(node, live);
        const spark = (history[node.node_id] || []).slice(-24).map((r) => Number(r.water_level_cm)).filter(Number.isFinite);
        return <button className={`station-row ${node.node_id === station.node_id ? "selected" : ""} ${risk}`} key={node.node_id} onClick={() => onSelect(node.node_id)}>
          <span className="station-name">{risk === "CRITICAL" || risk === "WARNING" ? <CircleAlert size={14} /> : risk === "STALE" ? <WifiOff size={14} /> : <CheckCircle2 size={14} />}{node.name}</span>
          <RiskLabel risk={risk} />
          <b>{toNumber(level)} cm</b>
          <small>{seen ? timeAgo(seen, now) : "no data"}</small>
          <Sparkline values={spark} />
        </button>;
      })}
    </section>
    <details className="audit"><summary><Activity size={14} /> Algorithm audit: last readings for {station.name} <ChevronDown size={15} /></summary>
      {auditRows.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Time (NPT)</th><th>Water cm</th><th>Rain mm</th><th>Soil %</th><th>EMA cm</th><th>Rate cm/min</th><th>HSI</th><th>Risk</th></tr></thead><tbody>
        {auditRows.map((r, i) => <tr key={`${r.timestamp}-${i}`}><td>{formatClock(r.timestamp, true)}</td><td>{toNumber(r.water_level_cm)}</td><td>{toNumber(r.rainfall_mm, 1)}</td><td>{toNumber(r.soil_moisture_pct, 1)}</td><td>{toNumber(r.ema_water_level)}</td><td>{toNumber(r.rate_of_change_cm_min)}</td><td>{toNumber(r.hsi_score)}</td><td><RiskLabel risk={r.risk_level || "NORMAL"} /></td></tr>)}
      </tbody></table></div> : <p className="muted">No readings yet.</p>}
      <p className="muted small">HSI = level score + 0.5 × rate score + soil score. Risk bands: WATCH ≥ 1.2, WARNING ≥ 2.0, CRITICAL ≥ 3.0, or the station's water-level thresholds, whichever trips first.</p>
    </details>
  </div>;
}
