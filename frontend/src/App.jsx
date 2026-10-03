import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, CheckCircle2, ChevronDown, CircleAlert, Clock3,
  History, LayoutGrid, MapPin, Menu, ShieldCheck, SlidersHorizontal,
  Users, X, Sun, Moon
} from "lucide-react";
import RiverMap from "./components/RiverMap";
import Logo from "./components/Logo";
import LandingPage from "./components/LandingPage";
import { fetchAlerts, fetchIncidents, fetchNodeReadings, fetchNodes, fetchSettlements, fetchStats, fetchTopology, login, updateSettlement, updateThresholds } from "./services/api";
import { useWebSocket } from "./hooks/useWebSocket";
import { triggerSpike } from "./services/api";

const fallbackNodes = [
  { node_id: "NODE_LANGTANG_01", name: "Langtang Glacier Catchment", lat: 28.22, lng: 85.61, current_risk: "NORMAL" },
  { node_id: "NODE_BHOTKOSHI_02", name: "Upper Bhotekoshi Gorge", lat: 28.08, lng: 85.89, current_risk: "NORMAL" },
  { node_id: "NODE_SYAPRUBESI_03", name: "Syaprubesi River Confluence", lat: 28.15, lng: 85.36, current_risk: "NORMAL" },
  { node_id: "NODE_MAILUNG_04", name: "Mailung Landslide Sector", lat: 28.03, lng: 85.31, current_risk: "NORMAL" },
  { node_id: "NODE_BETRAWATI_05", name: "Betrawati Bridge Gauge", lat: 27.98, lng: 85.19, current_risk: "NORMAL" },
  { node_id: "NODE_TRISHULI_06", name: "Trishuli Hydropower Headworks", lat: 27.87, lng: 85.17, current_risk: "NORMAL" }
];
const legacyRoutes = { "/monitor": "/app/monitor", "/alerts": "/app/alerts", "/incidents": "/app/incidents", "/configuration": "/app/configuration", "/public": "/bulletin" };

const names = ["Betrawati Market & Riverbank Settlement", "Syaprubesi Bazaar", "Trishuli Bazaar & Hydropower Colony", "Dhunche Town & District Hospital"];
const sampleAlerts = names.map((name, index) => ({
  alert_id: `sample-${index}`,
  affected_settlement_name: name,
  source_node_name: fallbackNodes[index % fallbackNodes.length].name,
  eta_minutes: [4, 5, 6, 12][index],
  population_at_risk: [8500, 4500, 26000, 12500][index],
  evacuation_zone: index % 2 ? "Monastery Ridge Evacuation Point" : "Betrawati Higher Secondary Grounds",
  risk_level: index === 3 ? "CRITICAL" : "WARNING",
  acknowledged: true
}));

function riskOf(node, live) {
  return live?.[node.node_id]?.risk_level || node.latest_reading?.risk_level || node.current_risk || "NORMAL";
}

function Shell({ page, setPage, children, onDemo, isConnected, activeAlertCount, session, onSignOut, onSignIn, theme, onToggleTheme }) {
  const nav = [
    ["/app/monitor", "Monitor", LayoutGrid],
    ["/app/alerts", "Alerts", Bell],
    ["/app/incidents", "Incidents", History],
    ["/app/configuration", "Configuration", SlidersHorizontal],
    ["/bulletin", "Public bulletin", MapPin]
  ];
  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><Logo variant="full" /></div>
      <nav>{nav.map(([id, label, Icon]) => <button className={page === id ? "nav-item active" : "nav-item"} onClick={() => setPage(id)} key={id}><Icon size={16} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><span className="status-dot" />{session ? `${session.role === "operator" ? "Operator" : "Viewer"} monitoring` : "Signed out"}</div>
    </aside>
    <main className="content">
      <header className="topbar"><button className="mobile-menu" aria-label="Open navigation"><Menu size={18} /></button><h1>{(page === "/bulletin" ? "Public bulletin" : page.slice(5).replace("-", " ")).replace(/^\w/, (letter) => letter.toUpperCase())}</h1><div className="top-status"><span><i className="connected-dot" /> MQTT connected</span><span><i className={isConnected ? "connected-dot" : ""} /> WebSocket {isConnected ? "live" : "reconnecting"}</span><span>Last reading 0s ago</span><Bell size={14} /><span>{activeAlertCount} active</span><button className="demo-button" onClick={onToggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button><button className="demo-button" onClick={onDemo}>Demo</button>{session ? <span className="user-chip"><span className="avatar">{session.username[0].toUpperCase()}</span><strong>{session.username}</strong><small>{session.role}</small><button className="signout-button" onClick={onSignOut}>Sign out</button></span> : <button className="demo-button" onClick={onSignIn}>Sign in</button>}</div></header>
      {children}
    </main>
  </div>;
}

function Stat({ value, label }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function MiniLine({ index = 0 }) {
  const paths = ["2,22 12,13 24,16 35,23 46,8 57,17", "2,18 14,20 25,10 36,8 47,14 57,21", "2,9 13,12 24,18 35,19 46,21 57,26", "2,17 12,9 23,16 34,10 45,22 57,15", "2,5 13,10 24,17 35,11 46,12 57,6", "2,8 13,14 24,21 35,13 46,18 57,17"];
  return <svg className="mini-line" viewBox="0 0 60 30" preserveAspectRatio="none"><polyline points={paths[index % paths.length]} /></svg>;
}

function StationChart({ readings, metric, thresholds = {} }) {
  const field = metric === "rate" ? "rate_of_change_cm_min" : metric === "hsi" ? "hsi_score" : "water_level_cm";
  const values = readings.length ? readings.map((r) => Number(r[field] || 0)) : metric === "rate" ? [2.4, 2.1, 2.8, 3.1, 2.7, 3.4] : metric === "hsi" ? [.42, .48, .51, .57, .61, .6] : [95, 96, 95.5, 96, 95.7, 96.3, 96.1, 96.25];
  const thresholdValues = metric === "water" ? [thresholds.water_level_watch, thresholds.water_level_warning, thresholds.water_level_critical].filter(Number.isFinite) : [];
  const dataMin = Math.min(...values, ...thresholdValues);
  const dataMax = Math.max(...values, ...thresholdValues);
  const padding = Math.max((dataMax - dataMin) * 0.08, metric === "rate" ? 1 : 1);
  const min = metric === "rate" ? Math.min(dataMin - padding, 0) : Math.max(0, dataMin - padding);
  const max = Math.max(dataMax + padding, metric === "rate" ? padding : 1);
  const scale = (value) => 100 - ((value - min) / Math.max(max - min, 1)) * 100;
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${scale(value)}`).join(" ");
  const formatAxis = (value) => Math.abs(value) < 10 && value % 1 !== 0 ? value.toFixed(1) : value.toFixed(0);
  return <div className="chart"><div className="chart-y"><span>{formatAxis(max)}</span><span>{formatAxis((max + min) / 2)}</span><span>{formatAxis(min)}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><g className="chart-grid">{[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} />)}{thresholdValues.map((threshold, index) => <line key={threshold} className={`threshold-line threshold-${index}`} x1="0" y1={scale(threshold)} x2="100" y2={scale(threshold)} />)}</g><polyline points={points} /></svg><div className="chart-x"><span>Recent</span><span>Latest</span></div></div>;
}

function DemoModal({ nodes, onClose, onTriggered }) {
  const [targetNode, setTargetNode] = useState(nodes[0]?.node_id || "NODE_LANGTANG_01");
  const [surge, setSurge] = useState(150);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await triggerSpike(targetNode, Number(surge));
      setMessage(`Spike sent to ${result.target_node}. Watch live telemetry for the risk transition.`);
      onTriggered(targetNode);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }

  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="demo-modal" onSubmit={submit}><div className="modal-heading"><div><h2>Run demo spike</h2><p>Demo controls are enabled for this local installation.</p></div><button type="button" onClick={onClose} aria-label="Close demo dialog"><X size={17} /></button></div>
      <label>Target station<select value={targetNode} onChange={(event) => setTargetNode(event.target.value)}>{nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.name}</option>)}</select></label>
      <label>Water surge <output>+{surge} cm</output><input type="range" min="80" max="220" step="10" value={surge} onChange={(event) => setSurge(event.target.value)} /></label>
      {message && <p className="demo-message">{message}</p>}<button className="demo-submit" disabled={busy}>{busy ? "Sending..." : "Send flood spike"}</button>
    </form>
  </div>;
}

function SignInModal({ onClose, onSignedIn }) {
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("operator");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await login(username, password);
      localStorage.setItem("trishuli-session", JSON.stringify(session));
      onSignedIn(session);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="demo-modal" onSubmit={submit}><div className="modal-heading"><div><h2>Sign in</h2><p>Use an operator or viewer account for this demo.</p></div><button type="button" onClick={onClose} aria-label="Close sign-in dialog"><X size={17} /></button></div>
      <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="demo-submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
    </form>
  </div>;
}

function MonitorPage({ nodes, topology, live, selectedNode, setSelectedNode, readings, stats, alerts, theme }) {
  const [metric, setMetric] = useState("water");
  const station = selectedNode || nodes[0] || fallbackNodes[4];
  const current = live[station.node_id] || station.latest_reading || {};
  const active = alerts.filter((alert) => !alert.acknowledged);
  return <div className="page monitor-page">
    <div className="stats-grid"><Stat value={nodes.filter((n) => riskOf(n, live) === "CRITICAL").length} label="Critical" /><Stat value={nodes.filter((n) => riskOf(n, live) === "WARNING").length} label="Warning" /><Stat value={active.length} label="Active routes" /><Stat value={(stats?.total_readings || 23838).toLocaleString()} label="Readings" /></div>
    <div className="monitor-grid">
      <section className="panel map-panel"><div className="panel-title-row"><h2>Station network</h2><span>Select a marker or station row</span></div><RiverMap theme={theme} nodes={nodes} settlements={topology?.settlements || []} topology={topology} selectedNodeId={station.node_id} onSelectNode={(id) => setSelectedNode(nodes.find((node) => node.node_id === id) || station)} latestTelemetryMap={live} /></section>
      <section className="panel settlement-panel"><div className="panel-title-row"><h2>Settlement alerts</h2><span>{active.length}</span></div>{active.length ? active.map((alert) => <div className="small-alert" key={alert.alert_id}><CircleAlert size={15} /><span>{alert.affected_settlement_name}</span></div>) : <div className="empty-state"><CheckCircle2 size={18} /><span>No active alerts</span></div>}<p className="panel-foot"><i /> Queue sorted by flood-wave arrival time</p></section>
    </div>
    <section className="panel telemetry-panel"><div className="panel-title-row"><h2><Activity size={15} /> {station.name}</h2><span className={`risk-label ${riskOf(station, live)}`}><i /> {riskOf(station, live)}</span></div><div className="tabs">{[["water", "Water"], ["rate", "Rate"], ["hsi", "HSI"]].map(([value, label]) => <button key={value} className={metric === value ? "selected" : ""} onClick={() => setMetric(value)}>{label}</button>)}</div><div className="telemetry-meta"><span>Water <b>{current.water_level_cm ?? "96.25"} cm</b></span><span>Rate <b>{current.rate_of_change_cm_min ?? "2.34"} cm/min</b></span><span>HSI <b>{current.hsi_score ?? "0.60"}</b></span><span>Components <b>L {current.s_level ?? "0.43"} · R {current.s_rate ?? "0.19"} · S {current.s_soil ?? "0.08"}</b></span></div><p className="risk-reason">{current.reason || "NORMAL: HSI below 1.2 and station thresholds are not crossed."}</p><StationChart readings={readings} metric={metric} thresholds={station.thresholds} /></section>
    <section className="panel station-panel"><div className="panel-title-row"><h2>Station status</h2><span>{nodes.length} stations</span></div>{nodes.map((node, index) => { const risk = riskOf(node, live); return <button className={`station-row ${node.node_id === station.node_id ? "selected" : ""} ${risk}`} key={node.node_id} onClick={() => setSelectedNode(node)}><span className="station-name">{risk === "CRITICAL" ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}{node.name}</span><span className={`risk-label ${risk}`}><i /> {risk}</span><b>{live[node.node_id]?.water_level_cm ?? node.latest_reading?.water_level_cm ?? ["46.07", "66.37", "85.08", "96.25", "65.86", "96.73"][index] ?? "—"} cm</b><small>3s ago</small><MiniLine index={index} /></button>; })}</section>
    <details className="audit"><summary><Activity size={14} /> Algorithm audit <ChevronDown size={15} /></summary></details>
  </div>;
}

function AlertsPage({ alerts }) {
  const items = alerts.length ? alerts : sampleAlerts;
  const active = items.filter((alert) => ["ACTIVE", "ACKNOWLEDGED"].includes(alert.status) || (!alert.status && !alert.acknowledged));
  const resolved = items.filter((alert) => alert.status === "RESOLVED" || alert.acknowledged);
  return <div className="page alerts-page"><h2>Alerts</h2><p className="page-subtitle">Acknowledge first, then track every route through resolution.</p><div className="alert-tabs"><span>Active&nbsp; {active.filter((alert) => alert.status === "ACTIVE" || !alert.status).length}</span><span>Acknowledged&nbsp; {active.filter((alert) => alert.status === "ACKNOWLEDGED").length}</span><span className="current">Resolved&nbsp; {resolved.length}</span><span>All&nbsp; {items.length}</span><span>Notification log</span></div><div className="lifecycle"><div className="panel-title-row"><h3>Alert lifecycle</h3><span>{items.length}</span></div>{items.map((alert, index) => { const isResolved = alert.status === "RESOLVED" || alert.acknowledged; const created = alert.created_at ? new Date(alert.created_at).toLocaleString() : "—"; const resolvedAt = alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : "Open"; return <div className="lifecycle-row" key={`${alert.alert_id}-${index}`}><span className={`alert-rail ${alert.risk_level}`}><CircleAlert size={13} /></span><div className="alert-main"><strong>{alert.affected_settlement_name}</strong><span>Source: {alert.source_node_name} · ETA&nbsp; <b>{alert.eta_minutes} min</b></span><small><Users size={13} /> {Number(alert.population_at_risk || 0).toLocaleString()} people <MapPin size={13} /> {alert.evacuation_zone}</small><small>Created {created} · Resolved {resolvedAt}</small></div><div className="resolved"><i /> {isResolved ? "RESOLVED" : alert.status || "ACTIVE"}</div><button className="row-menu" aria-label="Alert details"><Clock3 size={14} /><ChevronDown size={14} /></button></div>; })}</div></div>;
}

function IncidentsPage({ incidents }) {
  return <div className="page alerts-page"><h2>Incidents</h2><p className="page-subtitle">Recovered warning and critical periods from the live risk engine.</p><div className="lifecycle panel incident-list">{incidents.length ? incidents.map((incident) => <div className="lifecycle-row" key={incident.incident_id}><span className={`alert-rail ${incident.peak_risk}`}><CircleAlert size={13} /></span><div className="alert-main"><strong>{incident.incident_id}</strong><span>Source: {incident.source_node_id} · Peak&nbsp; <b>{incident.peak_risk}</b></span><small><Clock3 size={13} /> Started {new Date(incident.started_at).toLocaleString()} · {incident.recovered_at ? `Recovered ${new Date(incident.recovered_at).toLocaleString()}` : "Active"}</small></div></div>) : <div className="empty-state">No incidents recorded.</div>}</div></div>;
}

function ConfigurationPage({ nodes, settlements, setSettlements }) {
  const [selected, setSelected] = useState(nodes[0]?.node_id || "");
  const [message, setMessage] = useState("");
  const node = nodes.find((item) => item.node_id === selected) || nodes[0];
  const thresholds = node?.thresholds || { water_level_watch: 100, water_level_warning: 150, water_level_critical: 200 };
  const save = async (event) => { event.preventDefault(); setMessage(""); const form = new FormData(event.currentTarget); const values = { water_level_watch: Number(form.get("watch")), water_level_warning: Number(form.get("warning")), water_level_critical: Number(form.get("critical")) }; if (!(values.water_level_watch < values.water_level_warning && values.water_level_warning < values.water_level_critical)) { setMessage("Thresholds must be strictly ordered: watch < warning < critical."); return; } try { await updateThresholds(selected, values); setMessage("Thresholds saved."); } catch (error) { setMessage(error.message); } };
  const saveSettlement = async (event, settlement) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const updated = await updateSettlement(settlement.settlement_id, { name: form.get("name"), evacuation_zone: form.get("evacuation_zone"), population: Number(form.get("population")) }); setSettlements((current) => current.map((item) => item.settlement_id === updated.settlement_id ? updated : item)); setMessage("Settlement saved."); } catch (error) { setMessage(error.message); } };
  return <div className="page alerts-page"><h2>Configuration</h2><p className="page-subtitle">Review station thresholds and settlement routing metadata.</p>{message && <p className="form-error">{message}</p>}<div className="config-grid"><form className="panel config-form" onSubmit={save}><div className="panel-title-row"><h3>Station thresholds</h3><span>Live engine</span></div><label>Station<select value={selected} onChange={(event) => setSelected(event.target.value)}>{nodes.map((item) => <option key={item.node_id} value={item.node_id}>{item.name}</option>)}</select></label><label>Watch<input name="watch" type="number" defaultValue={thresholds.water_level_watch} /></label><label>Warning<input name="warning" type="number" defaultValue={thresholds.water_level_warning} /></label><label>Critical<input name="critical" type="number" defaultValue={thresholds.water_level_critical} /></label><button className="demo-submit">Save thresholds</button></form><section className="panel config-form"><div className="panel-title-row"><h3>Settlements</h3><span>{settlements.length}</span></div>{settlements.map((settlement) => <form className="settlement-edit" key={settlement.settlement_id} onSubmit={(event) => saveSettlement(event, settlement)}><label>Name<input name="name" defaultValue={settlement.name} /></label><label>Evacuation zone<input name="evacuation_zone" defaultValue={settlement.evacuation_zone || ""} /></label><label>Population<input name="population" type="number" min="0" defaultValue={settlement.population || 0} /></label><button className="row-menu">Save</button></form>)}</section></div></div>;
}

function PublicPage({ nodes, alerts }) {
  return <div className="page public-page"><section className="public-hero"><div><h2>Flood risk in your area</h2><p>Current conditions for the Trishuli and Bhotekoshi watersheds. Follow local instructions and move to higher ground if your settlement is under alert.</p></div><div className="public-status"><ShieldCheck size={22} /><strong>{alerts.length ? "Active alerts" : "No active alerts"}</strong><span>{alerts.length ? "Continue to follow local responder directions." : "Continue normal activities and stay informed."}</span></div></section><section className="guidance"><h3>General safety guidance</h3><p>Take essential medicines, documents, and water. Move to higher ground when instructed and follow local responder directions.</p></section><div className="public-grid"><section className="panel public-stations"><div className="panel-title-row"><h3>Station conditions</h3><span>Live monitoring</span></div>{nodes.map((node) => <div className="public-row" key={node.node_id}><div><strong>{node.name}</strong><small>{node.node_id}</small></div><span className="normal-label"><i /> NORMAL</span></div>)}</section><section className="panel public-guidance"><div className="panel-title-row"><h3>Settlement guidance</h3><span>0 routes</span></div><div className="empty-state"><ShieldCheck size={18} /><span>No settlements are currently under alert.</span></div></section></div></div>;
}

export default function App() {
  const requestedPath = window.location.pathname;
  const initialPage = legacyRoutes[requestedPath] || (["/", "/app/monitor", "/app/alerts", "/app/incidents", "/app/configuration", "/bulletin"].includes(requestedPath) ? requestedPath : "/");
  const [page, setPage] = useState(initialPage);
  const [nodes, setNodes] = useState(fallbackNodes), [topology, setTopology] = useState(null), [alerts, setAlerts] = useState([]), [live, setLive] = useState({}), [stats, setStats] = useState(null), [selectedNode, setSelectedNode] = useState(fallbackNodes[4]), [readings, setReadings] = useState([]), [demoOpen, setDemoOpen] = useState(false), [signInOpen, setSignInOpen] = useState(false), [incidents, setIncidents] = useState([]), [settlements, setSettlements] = useState([]), [session, setSession] = useState(() => { try { return JSON.parse(localStorage.getItem("trishuli-session")) || null; } catch { return null; } }), [theme, setTheme] = useState(() => { const saved = localStorage.getItem("trishuli-theme"); return saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); });
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("trishuli-theme", theme); }, [theme]);
  useEffect(() => { if (legacyRoutes[requestedPath]) window.history.replaceState({}, "", page); }, [page, requestedPath]);
  useEffect(() => { const routeTitle = page === "/" ? "Early warning for the basin" : page === "/bulletin" ? "Public bulletin" : page.slice(5).replace("-", " "); document.title = `${routeTitle.charAt(0).toUpperCase()}${routeTitle.slice(1)} | Trishuli Early Warning System`; }, [page]);
  const selectedRef = useRef(selectedNode?.node_id);
  useEffect(() => { selectedRef.current = selectedNode?.node_id; }, [selectedNode]);
  useEffect(() => {
    const expireSession = () => { setSession(null); setSignInOpen(true); };
    window.addEventListener("trishuli-session-expired", expireSession);
    return () => window.removeEventListener("trishuli-session-expired", expireSession);
  }, []);
  useEffect(() => { Promise.allSettled([fetchNodes(), fetchTopology(), fetchAlerts(), fetchStats(), fetchIncidents(), fetchSettlements()]).then(([node, topo, alert, stat, incident, settlement]) => { if (node.status === "fulfilled" && node.value.length) { setNodes(node.value); setSelectedNode(node.value.find((item) => item.node_id === "NODE_BETRAWATI_05") || node.value[0]); } if (topo.status === "fulfilled") setTopology(topo.value); if (alert.status === "fulfilled") setAlerts(alert.value); if (stat.status === "fulfilled") setStats(stat.value); if (incident.status === "fulfilled") setIncidents(incident.value); if (settlement.status === "fulfilled") setSettlements(settlement.value); }); }, []);
  const loadReadings = useCallback(async (id) => { if (!id) return; try { const result = await fetchNodeReadings(id, 60); if (selectedRef.current === id) startTransition(() => setReadings(result)); } catch (error) { console.error("Failed to load readings:", error); } }, []);
  useEffect(() => { loadReadings(selectedNode?.node_id); }, [selectedNode, loadReadings]);
  const onMessage = useCallback((packet) => {
    if (packet.type === "TELEMETRY_UPDATE") {
      setLive((previous) => ({ ...previous, [packet.data.node_id]: packet.data }));
    } else if (packet.type === "NEW_ALERTS") {
      setAlerts((previous) => {
        const next = new Map(previous.map((alert) => [alert.alert_id, alert]));
        (packet.data || []).forEach((alert) => next.set(alert.alert_id, { ...next.get(alert.alert_id), ...alert, acknowledged: false }));
        return Array.from(next.values());
      });
    } else if (packet.type === "ALERTS_RESOLVED") {
      setAlerts((previous) => previous.map((alert) => alert.source_node_id === packet.source_node_id ? { ...alert, acknowledged: true, status: "RESOLVED" } : alert));
    }
  }, []);
  const { isConnected } = useWebSocket(import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000/ws/stream", onMessage);
  const navigate = useCallback((path) => { window.history.pushState({}, "", path); startTransition(() => setPage(path)); }, []);
  const pageContent = useMemo(() => page === "/" ? <LandingPage nodes={nodes} settlements={settlements} live={live} onNavigate={navigate} /> : page === "/app/alerts" ? <AlertsPage alerts={alerts} /> : page === "/app/incidents" ? <IncidentsPage incidents={incidents} /> : page === "/app/configuration" ? <ConfigurationPage nodes={nodes} settlements={settlements} setSettlements={setSettlements} /> : page === "/bulletin" ? <PublicPage nodes={nodes} alerts={alerts.filter((alert) => !alert.acknowledged)} /> : <MonitorPage theme={theme} nodes={nodes} topology={topology} live={live} selectedNode={selectedNode} setSelectedNode={setSelectedNode} readings={readings} stats={stats} alerts={alerts} />, [page, nodes, topology, live, selectedNode, readings, stats, alerts, incidents, settlements, theme, navigate]);
  const signOut = () => { localStorage.removeItem("trishuli-session"); setSession(null); };
  if (page === "/") return pageContent;
  return <Shell page={page} setPage={navigate} onDemo={() => setDemoOpen(true)} onSignIn={() => setSignInOpen(true)} onSignOut={signOut} onToggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")} theme={theme} session={session} isConnected={isConnected} activeAlertCount={alerts.filter((alert) => !alert.acknowledged).length}>{pageContent}{demoOpen && <DemoModal nodes={nodes} onClose={() => setDemoOpen(false)} onTriggered={(nodeId) => { setSelectedNode(nodes.find((node) => node.node_id === nodeId) || selectedNode); navigate("/app/monitor"); }} />}{signInOpen && <SignInModal onClose={() => setSignInOpen(false)} onSignedIn={setSession} />}</Shell>;
}
