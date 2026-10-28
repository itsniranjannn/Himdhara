import React, { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import LineChart from "../components/LineChart";
import { EmptyState, Field, Loading, Stat } from "../components/ui";
import { parseUtc, toNumber } from "../lib/format";
import { exportReadings, fetchAnalytics, fetchNodeReadings } from "../services/api";

const RANGES = [[1, "Last hour"], [6, "Last 6 hours"], [24, "Last 24 hours"], [168, "Last 7 days"]];
const RISK_COLORS = ["NORMAL", "WATCH", "WARNING", "CRITICAL"];

function RiskBar({ counts }) {
  const total = RISK_COLORS.reduce((sum, key) => sum + (counts[key] || 0), 0);
  if (!total) return <span className="muted">—</span>;
  return <div className="risk-bar" role="img" aria-label={RISK_COLORS.map((key) => `${key} ${Math.round(((counts[key] || 0) / total) * 100)}%`).join(", ")}>
    {RISK_COLORS.map((key) => counts[key] ? <span key={key} className={`seg ${key}`} style={{ width: `${(counts[key] / total) * 100}%` }} title={`${key}: ${counts[key]}`} /> : null)}
  </div>;
}

export default function AnalyticsPage({ nodes, selectedId, session, onSignIn }) {
  const [hours, setHours] = useState(6);
  const [nodeId, setNodeId] = useState(selectedId || nodes[0]?.node_id || "");
  // Results are stored with the request they answer, so a stale response is never shown for a new selection.
  const [summaryState, setSummaryState] = useState({ key: null, data: null });
  const [readingsState, setReadingsState] = useState({ key: null, data: null });
  const [error, setError] = useState("");
  const node = nodes.find((item) => item.node_id === nodeId) || nodes[0];
  const nodeKey = node?.node_id;
  const summaryKey = String(hours);
  const readingsKey = `${nodeKey}:${hours}`;
  const summary = summaryState.key === summaryKey ? summaryState.data : null;
  const readings = readingsState.key === readingsKey ? readingsState.data : null;

  useEffect(() => {
    let cancelled = false;
    fetchAnalytics(hours).then((data) => !cancelled && setSummaryState({ key: String(hours), data })).catch((failure) => !cancelled && setError(failure.message));
    return () => { cancelled = true; };
  }, [hours]);

  useEffect(() => {
    if (!nodeKey) return undefined;
    let cancelled = false;
    fetchNodeReadings(nodeKey, { hours, limit: 400 }).then((data) => !cancelled && setReadingsState({ key: `${nodeKey}:${hours}`, data })).catch((failure) => !cancelled && setError(failure.message));
    return () => { cancelled = true; };
  }, [nodeKey, hours]);

  const points = useMemo(() => (readings || []).map((r) => ({ t: parseUtc(r.timestamp)?.getTime(), v: Number(r.water_level_cm) })).filter((p) => p.t && Number.isFinite(p.v)), [readings]);
  async function exportCsv() {
    setError("");
    if (!session) return onSignIn();
    try { await exportReadings(node?.node_id, hours); } catch (failure) { setError(failure.message); }
  }

  return <div className="page alerts-page">
    <div className="page-heading-row">
      <div><h2>Analytics</h2><p className="page-subtitle">Water-level history and risk statistics from stored readings.</p></div>
      <button className="demo-submit with-icon" onClick={exportCsv} title={session ? "Download these readings as CSV" : "Sign in to export"}><Download size={15} /> Export readings</button>
    </div>
    {error && <p className="form-error">{error}</p>}
    <div className="filter-row">
      <Field label="Time range"><select value={hours} onChange={(event) => setHours(Number(event.target.value))}>{RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Station"><select value={node?.node_id || ""} onChange={(event) => setNodeId(event.target.value)}>{nodes.map((item) => <option key={item.node_id} value={item.node_id}>{item.name}</option>)}</select></Field>
    </div>
    <div className="stats-grid">
      <Stat value={summary ? summary.readings_total.toLocaleString() : "—"} label="Readings in range" />
      <Stat value={summary ? summary.alerts_created : "—"} label="Alerts raised" />
      <Stat value={summary ? summary.incidents_started : "—"} label="Incidents" />
      <Stat value={summary ? summary.stations.length : "—"} label="Stations reporting" />
    </div>
    <section className="panel">
      <div className="panel-title-row"><h3>{node?.name || "Station"} · water level</h3><span>{points.length} points</span></div>
      {readings === null ? <Loading label="Loading history…" /> : <LineChart points={points} thresholds={node?.thresholds} unit="cm" height={260} ariaLabel={`Water level history for ${node?.name}`} empty="No readings stored for this range yet." />}
    </section>
    <section className="panel analytics-table">
      <div className="panel-title-row"><h3>Station statistics</h3><span>{RANGES.find(([value]) => value === hours)?.[1]}</span></div>
      {!summary ? <Loading label="Calculating…" /> : summary.stations.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Station</th><th>Readings</th><th>Min cm</th><th>Avg cm</th><th>Max cm</th><th>Peak HSI</th><th>Peak rain mm</th><th>Time in each risk band</th></tr></thead><tbody>
        {summary.stations.map((row) => <tr key={row.node_id}><td>{row.name}</td><td>{row.readings.toLocaleString()}</td><td>{toNumber(row.water_min_cm)}</td><td>{toNumber(row.water_avg_cm)}</td><td>{toNumber(row.water_max_cm)}</td><td>{toNumber(row.hsi_max)}</td><td>{toNumber(row.rainfall_max_mm, 1)}</td><td><RiskBar counts={row.risk_counts} /></td></tr>)}
      </tbody></table></div> : <EmptyState>No readings in this range.</EmptyState>}
      <div className="legend-row">{RISK_COLORS.map((key) => <span key={key}><i className={`seg-dot ${key}`} /> {key}</span>)}</div>
    </section>
  </div>;
}
