import React, { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CheckCircle2, CircleAlert, Minus, ShieldCheck, Siren, WifiOff } from "lucide-react";
import RiverMap from "../components/RiverMap";
import LineChart from "../components/LineChart";
import RainOutlook from "../components/RainOutlook";
import RiverFlow from "../components/RiverFlow";
import { EmptyState, Loading, RiskLabel } from "../components/ui";
import { RISK_RANK, formatClock, lastSeen, parseUtc, riskOf, timeAgo, toNumber } from "../lib/format";

const NO_READINGS = [];
const METRICS = {
  water: { label: "Water level", field: "water_level_cm", unit: "cm" },
  rate: { label: "Rate of change", field: "rate_of_change_cm_min", unit: "cm/min" },
  hsi: { label: "Stress index", field: "hsi_score", unit: "" },
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

// The one-glance answer to "is anything dangerous in this basin right now?"
function StatusBand({ basin, nodes, risks, openAlerts, stats, onOpenAlerts }) {
  const count = (level) => risks.filter((risk) => risk === level).length;
  const worst = ["CRITICAL", "WARNING", "WATCH"].find((level) => count(level) > 0);
  const offline = count("STALE");
  const firstImpact = openAlerts.length ? Math.min(...openAlerts.map((alert) => alert.eta_minutes)) : null;
  const names = nodes.filter((_, index) => risks[index] === worst).map((node) => node.name);
  let tone = "normal", Icon = ShieldCheck, headline = `All clear in the ${basin?.name} basin`, detail = `${nodes.length - offline} of ${nodes.length} stations are reporting normal conditions and no settlement is under alert.`;
  if (worst === "CRITICAL" || worst === "WARNING") {
    tone = worst.toLowerCase(); Icon = Siren;
    headline = `${worst === "CRITICAL" ? "Critical" : "Warning"}: ${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
    detail = openAlerts.length ? `${openAlerts.length} settlement${openAlerts.length > 1 ? "s" : ""} downstream at risk. First flood-wave arrival in about ${Math.round(firstImpact)} minutes.` : "Station readings exceed safe limits. Downstream routes are being calculated.";
  } else if (worst === "WATCH") {
    tone = "watch"; Icon = CircleAlert;
    headline = `Watch: ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""} rising`;
    detail = "Readings are above normal but below warning limits. Keep monitoring.";
  } else if (offline === nodes.length) {
    tone = "stale"; Icon = WifiOff; headline = "No live readings"; detail = "Every station in this basin is silent, so its risk cannot be assessed.";
  } else if (offline > 0) {
    detail += ` ${offline} station${offline > 1 ? "s are" : " is"} offline.`;
  }
  return <section className={`status-band ${tone}`} aria-live="polite">
    <div className="status-icon"><Icon size={28} /></div>
    <div className="status-copy"><p className="status-eyebrow">{basin?.name?.toUpperCase()} BASIN · {basin?.region}</p><h2>{headline}</h2><p>{detail}</p></div>
    <dl className="status-figures">
      <div><dt>Open alerts</dt><dd>{openAlerts.length}</dd></div>
      <div><dt>Stations OK</dt><dd>{count("NORMAL")}<small>/{nodes.length}</small></dd></div>
      <div><dt>Readings stored</dt><dd>{stats ? stats.total_readings.toLocaleString() : "—"}</dd></div>
    </dl>
    {openAlerts.length > 0 && <button className="status-cta" onClick={onOpenAlerts}>Review alerts <ArrowRight size={14} /></button>}
  </section>;
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
    <StatusBand basin={basin} nodes={nodes} risks={risks} openAlerts={openAlerts} stats={stats} onOpenAlerts={() => navigate("/app/alerts")} />

    <div className="map-stage">
      <section className="map-card" aria-label="Station map">
        <RiverMap key={basin?.basin_id} theme={theme} nodes={nodes} settlements={topology?.settlements || []} topology={topology} selectedNodeId={station.node_id} onSelectNode={onSelect} latestTelemetryMap={live} riskFor={(node) => riskOf(node, live, now, staleSeconds)} />
      </section>
      <aside className="rail">
        <section className="rail-section">
          <header><h3>Stations</h3><span>{nodes.length}</span></header>
          <div className="rail-list">
            {[...nodes].sort((a, b) => RISK_RANK[riskOf(b, live, now, staleSeconds)] - RISK_RANK[riskOf(a, live, now, staleSeconds)] || a.name.localeCompare(b.name)).map((node) => {
              const risk = riskOf(node, live, now, staleSeconds);
              const level = live[node.node_id]?.water_level_cm ?? node.latest_reading?.water_level_cm;
              const seen = lastSeen(node, live);
              const spark = (history[node.node_id] || []).slice(-24).map((r) => Number(r.water_level_cm)).filter(Number.isFinite);
              return <button className={`station-row ${node.node_id === station.node_id ? "selected" : ""} ${risk}`} key={node.node_id} onClick={() => onSelect(node.node_id)}>
                <span className="station-name">{risk === "CRITICAL" || risk === "WARNING" ? <CircleAlert size={14} /> : risk === "STALE" ? <WifiOff size={14} /> : <CheckCircle2 size={14} />}<span className="station-title">{node.name}</span></span>
                <RiskLabel risk={risk} />
                <b>{toNumber(level)} cm</b>
                <small>{seen ? timeAgo(seen, now) : "no data"}</small>
                <Sparkline values={spark} />
              </button>;
            })}
          </div>
        </section>
        <section className="rail-section alerts-rail">
          <header><h3>Settlements at risk</h3><span>{sortedAlerts.length}</span></header>
          {sortedAlerts.length
            ? <div className="rail-list">{sortedAlerts.slice(0, 5).map((alert) => <button className="small-alert" key={alert.alert_id} onClick={() => navigate("/app/alerts")}><CircleAlert size={15} /><span>{alert.affected_settlement_name}</span><b>{Math.round(alert.eta_minutes)} min</b></button>)}</div>
            : <EmptyState>No settlements under alert</EmptyState>}
          {sortedAlerts.length > 5 && <button className="link-button rail-more" onClick={() => navigate("/app/alerts")}>View all {sortedAlerts.length} <ArrowRight size={12} /></button>}
        </section>
      </aside>
    </div>

    <section className="panel telemetry-panel">
      <div className="panel-title-row"><h2><Activity size={16} /> {station.name}</h2><RiskLabel risk={stationRisk} /></div>
      <div className="telemetry-top">
        <div className="reading-tiles">
          <div><span>Water level</span><b>{toNumber(current.water_level_cm)}<small> cm</small></b></div>
          <div><span>Rate</span><b>{toNumber(current.rate_of_change_cm_min)}<small> cm/min</small></b></div>
          <div><span>Stress index</span><b>{toNumber(current.hsi_score)}</b></div>
          <div><span>Rain</span><b>{toNumber(current.rainfall_mm, 1)}<small> mm</small></b></div>
          <div><span>Soil</span><b>{toNumber(current.soil_moisture_pct, 1)}<small> %</small></b></div>
        </div>
        <div className="tabs" role="tablist" aria-label="Metric">{Object.entries(METRICS).map(([key, item]) => <button key={key} role="tab" aria-selected={metric === key} className={metric === key ? "selected" : ""} onClick={() => setMetric(key)}>{item.label}</button>)}</div>
      </div>
      <p className="risk-reason" title="Level, rate and soil components of the Hydrological Stress Index">{stationRisk === "STALE" ? "No recent reading: this station is offline, so its risk cannot be assessed." : current.reason || "Waiting for the first reading."} <span className="muted">Components L {toNumber(current.s_level)} · R {toNumber(current.s_rate)} · S {toNumber(current.s_soil)}</span></p>
      <LineChart points={points} thresholds={metric === "water" ? station.thresholds : {}} unit={meta.unit} height={260} showThresholds={metric === "water"} ariaLabel={`${station.name} ${meta.label} over time`} />
      <ForecastStrip forecast={forecast} />
    </section>

    <RainOutlook weather={weather} />
    {basin && <RiverFlow basinId={basin.basin_id} />}

    <details className="audit"><summary><Activity size={14} /> Algorithm audit: last readings for {station.name} <ChevronDown size={15} /></summary>
      {auditRows.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Time (NPT)</th><th>Water cm</th><th>Rain mm</th><th>Soil %</th><th>EMA cm</th><th>Rate cm/min</th><th>HSI</th><th>Risk</th></tr></thead><tbody>
        {auditRows.map((r, i) => <tr key={`${r.timestamp}-${i}`}><td>{formatClock(r.timestamp, true)}</td><td>{toNumber(r.water_level_cm)}</td><td>{toNumber(r.rainfall_mm, 1)}</td><td>{toNumber(r.soil_moisture_pct, 1)}</td><td>{toNumber(r.ema_water_level)}</td><td>{toNumber(r.rate_of_change_cm_min)}</td><td>{toNumber(r.hsi_score)}</td><td><RiskLabel risk={r.risk_level || "NORMAL"} /></td></tr>)}
      </tbody></table></div> : <p className="muted">No readings yet.</p>}
      <p className="muted small">HSI = level score + 0.5 × rate score + soil score. Risk bands: WATCH ≥ 1.2, WARNING ≥ 2.0, CRITICAL ≥ 3.0, or the station&apos;s water-level thresholds, whichever trips first.</p>
    </details>
  </div>;
}
