import React, { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import Shell from "./components/Shell";
import Modal from "./components/Modal";
import { Field } from "./components/ui";
import { useNow } from "./hooks/useNow";
import { useWebSocket } from "./hooks/useWebSocket";
import { DEFAULT_STALE_SECONDS, OPEN_STATUSES } from "./lib/format";
import AlertsPage from "./pages/AlertsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import BulletinPage from "./pages/BulletinPage";
import ConfigurationPage from "./pages/ConfigurationPage";
import IncidentsPage from "./pages/IncidentsPage";
import MonitorPage from "./pages/MonitorPage";
import { WS_URL, fetchAlerts, fetchForecast, fetchHealth, fetchIncidents, fetchNodeReadings, fetchNodes, fetchSettlements, fetchStats, fetchTopology, login, resetSimulation, triggerSpike } from "./services/api";

const LandingPage = React.lazy(() => import("./components/LandingPage"));
const ROUTES = ["/", "/app/monitor", "/app/alerts", "/app/analytics", "/app/incidents", "/app/configuration", "/bulletin"];
const LEGACY = { "/monitor": "/app/monitor", "/alerts": "/app/alerts", "/incidents": "/app/incidents", "/configuration": "/app/configuration", "/public": "/bulletin", "/app": "/app/monitor" };
const HISTORY_LIMIT = 120;
const TITLES = { "/": "Early warning for the basin", "/bulletin": "Public bulletin", "/app/monitor": "Monitor", "/app/alerts": "Alerts", "/app/analytics": "Analytics", "/app/incidents": "Incidents", "/app/configuration": "Configuration" };

const pathFromLocation = () => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return LEGACY[path] || (ROUTES.includes(path) ? path : "/");
};
const readSession = () => { try { return JSON.parse(localStorage.getItem("trishuli-session")) || null; } catch { return null; } };
const readTheme = () => {
  try { const saved = localStorage.getItem("trishuli-theme"); if (saved) return saved; } catch { /* storage unavailable */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

function SignInModal({ reason, onClose, onSignedIn }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const session = await login(form.get("username"), form.get("password"));
      localStorage.setItem("trishuli-session", JSON.stringify(session));
      onSignedIn(session);
      onClose();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }
  return <Modal title="Sign in" description={reason || "Operators can acknowledge alerts, edit settings and run demos."} onClose={onClose} onSubmit={submit}>
    <Field label="Username"><input name="username" autoComplete="username" required /></Field>
    <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="demo-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </Modal>;
}

function DemoModal({ nodes, defaultNode, onClose, onTriggered, onReset }) {
  const [targetNode, setTargetNode] = useState(defaultNode || nodes[0]?.node_id || "");
  const [surge, setSurge] = useState(150);
  const [state, setState] = useState({ busy: false, text: "", error: false });
  async function run(action, success) {
    setState({ busy: true, text: "", error: false });
    try { await action(); setState({ busy: false, text: success, error: false }); } catch (failure) { setState({ busy: false, text: failure.message, error: true }); }
  }
  return <Modal title="Run demo spike" description="Simulates a flash flood on one station so you can watch detection, routing and alerts react." onClose={onClose}
    onSubmit={(event) => { event.preventDefault(); run(async () => { await triggerSpike(targetNode, surge); onTriggered(targetNode); }, "Spike sent. Watch the station turn WARNING then CRITICAL within a few readings."); }}>
    <Field label="Target station"><select value={targetNode} onChange={(event) => setTargetNode(event.target.value)}>{nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.name}</option>)}</select></Field>
    <Field label={<>Water surge <output>+{surge} cm</output></>}><input type="range" min="80" max="220" step="10" value={surge} onChange={(event) => setSurge(Number(event.target.value))} /></Field>
    {state.text && <p className={state.error ? "form-error" : "demo-message"} role={state.error ? "alert" : "status"}>{state.text}</p>}
    <div className="modal-actions">
      <button className="demo-submit" disabled={state.busy}>{state.busy ? "Sending…" : "Send flood spike"}</button>
      <button type="button" className="demo-button" disabled={state.busy} onClick={() => run(async () => { await resetSimulation(); onReset(); }, "Simulation reset. All stations are back to baseline and open alerts are closed.")}>Reset simulation</button>
    </div>
  </Modal>;
}

export default function App() {
  const [page, setPage] = useState(pathFromLocation);
  const [theme, setTheme] = useState(readTheme);
  const [session, setSession] = useState(readSession);
  const [signIn, setSignIn] = useState(null); // null | { reason }
  const [demoOpen, setDemoOpen] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [topology, setTopology] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);
  const [settlements, setSettlements] = useState([]);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState("");
  const [live, setLive] = useState({});
  const [history, setHistory] = useState({});
  const [forecastState, setForecastState] = useState({ id: null, data: null });
  const [selectedId, setSelectedId] = useState(null);
  const now = useNow(1000);
  const staleSeconds = health?.stale_after_seconds || DEFAULT_STALE_SECONDS;

  const toggleTheme = useCallback(() => setTheme((current) => (current === "dark" ? "light" : "dark")), []);
  const navigate = useCallback((path) => {
    window.history.pushState({}, "", path);
    window.scrollTo(0, 0);
    startTransition(() => setPage(path));
  }, []);

  // --- document chrome ---
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("trishuli-theme", theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { document.title = `${TITLES[page]} | Trishuli Early Warning System`; }, [page]);
  useEffect(() => {
    const onPop = () => setPage(pathFromLocation());
    window.addEventListener("popstate", onPop);
    if (window.location.pathname !== page && window.location.pathname !== "/") window.history.replaceState({}, "", page);
    return () => window.removeEventListener("popstate", onPop);
  }, [page]);
  useEffect(() => {
    const expire = () => { setSession(null); setSignIn({ reason: "Your session ended. Sign in again to continue." }); };
    window.addEventListener("trishuli-session-expired", expire);
    return () => window.removeEventListener("trishuli-session-expired", expire);
  }, []);

  // --- data loading ---
  const refreshAlerts = useCallback(() => fetchAlerts().then((rows) => { setAlerts(rows); setAlertsLoaded(true); }).catch(() => setAlertsLoaded(true)), []);
  const refreshNodes = useCallback(() => fetchNodes().then((rows) => { setNodes(rows); setLoaded(true); return rows; }).catch(() => { setLoaded(true); return null; }), []);

  useEffect(() => {
    refreshNodes().then((rows) => {
      if (!rows?.length) return;
      setSelectedId((current) => current || [...rows].sort((a, b) => ["CRITICAL", "WARNING", "WATCH"].indexOf(a.current_risk) - ["CRITICAL", "WARNING", "WATCH"].indexOf(b.current_risk))[0]?.node_id);
      Promise.all(rows.map((node) => fetchNodeReadings(node.node_id, { limit: HISTORY_LIMIT }).then((readings) => [node.node_id, readings]).catch(() => [node.node_id, []])))
        .then((entries) => setHistory(Object.fromEntries(entries)));
    });
    refreshAlerts();
    fetchTopology().then(setTopology).catch(() => {});
    fetchIncidents().then((rows) => { setIncidents(rows); setIncidentsLoaded(true); }).catch(() => setIncidentsLoaded(true));
    fetchSettlements().then(setSettlements).catch(() => {});
  }, [refreshNodes, refreshAlerts]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [status, counters] = await Promise.all([fetchHealth(), fetchStats()]);
        if (!active) return;
        setHealth(status); setStats(counters); setHealthError("");
      } catch (failure) {
        if (active) setHealthError(failure.message);
      }
    };
    poll();
    const timer = window.setInterval(poll, 10000);
    const slow = window.setInterval(() => { refreshNodes(); fetchIncidents().then(setIncidents).catch(() => {}); }, 30000);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(slow); };
  }, [refreshNodes]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    const load = () => fetchForecast(selectedId).then((data) => active && setForecastState({ id: selectedId, data })).catch(() => active && setForecastState({ id: selectedId, data: null }));
    load();
    const timer = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId]);

  // --- live stream ---
  const onMessage = useCallback((packet) => {
    if (packet.type === "TELEMETRY_UPDATE") {
      const data = packet.data;
      setLive((previous) => ({ ...previous, [data.node_id]: { ...data, receivedAt: Date.now() } }));
      setHistory((previous) => ({ ...previous, [data.node_id]: [...(previous[data.node_id] || []), data].slice(-HISTORY_LIMIT) }));
    } else if (packet.type === "NEW_ALERTS") {
      setAlerts((previous) => {
        const next = new Map(previous.map((alert) => [alert.alert_id, alert]));
        (packet.data || []).forEach((alert) => next.set(alert.alert_id, { status: "ACTIVE", created_at: new Date().toISOString(), ...next.get(alert.alert_id), ...alert }));
        return [...next.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      });
      refreshAlerts();
    } else if (packet.type === "ALERT_UPDATED") {
      setAlerts((previous) => previous.map((alert) => (alert.alert_id === packet.data.alert_id ? { ...alert, ...packet.data } : alert)));
    } else if (packet.type === "ALERTS_RESOLVED" || packet.type === "ALERTS_REFRESH") {
      refreshAlerts();
      fetchIncidents().then(setIncidents).catch(() => {});
    }
  }, [refreshAlerts]);
  const { isConnected } = useWebSocket(WS_URL, onMessage);

  // --- derived ---
  const forecast = forecastState.id === selectedId ? forecastState.data : null; // never show another station's trend
  const openAlerts = useMemo(() => alerts.filter((alert) => OPEN_STATUSES.includes(alert.status)), [alerts]);
  const signOut = () => { localStorage.removeItem("trishuli-session"); setSession(null); };
  const askSignIn = (reason) => setSignIn({ reason });
  const openDemo = () => (session?.role === "operator" ? setDemoOpen(true) : askSignIn("Sign in as an operator to run the demo."));
  const onThresholdsSaved = (nodeId, thresholds) => setNodes((current) => current.map((node) => (node.node_id === nodeId ? { ...node, thresholds } : node)));

  if (page === "/") {
    return <React.Suspense fallback={<div className="landing-loading" aria-label="Loading"><span /><span /><span /></div>}>
      <LandingPage nodes={nodes} settlements={settlements} live={live} onNavigate={navigate} />
    </React.Suspense>;
  }
  if (page === "/bulletin") {
    return <BulletinPage nodes={nodes} loaded={loaded} openAlerts={openAlerts} settlements={settlements} live={live} now={now} staleSeconds={staleSeconds} apiDown={!!healthError} theme={theme} onToggleTheme={toggleTheme} navigate={navigate} />;
  }

  const content = {
    "/app/monitor": <MonitorPage nodes={nodes} loaded={loaded} topology={topology} live={live} history={history} selectedId={selectedId} onSelect={setSelectedId} stats={stats} openAlerts={openAlerts} forecast={forecast} theme={theme} now={now} staleSeconds={staleSeconds} navigate={navigate} />,
    "/app/alerts": <AlertsPage alerts={alerts} loaded={alertsLoaded} session={session} onSignIn={() => askSignIn()} />,
    "/app/analytics": <AnalyticsPage nodes={nodes} selectedId={selectedId} session={session} onSignIn={() => askSignIn("Sign in to export data.")} />,
    "/app/incidents": <IncidentsPage incidents={incidents} loaded={incidentsLoaded} nodes={nodes} session={session} onSignIn={() => askSignIn("Sign in to export data.")} now={now} />,
    "/app/configuration": <ConfigurationPage nodes={nodes} settlements={settlements} setSettlements={setSettlements} onThresholdsSaved={onThresholdsSaved} session={session} onSignIn={() => askSignIn()} health={health} />,
  }[page];

  return <Shell page={page} navigate={navigate} health={health} healthError={healthError} isConnected={isConnected} nodes={nodes} live={live} now={now}
    openAlerts={openAlerts.length} session={session} onSignIn={() => askSignIn()} onSignOut={signOut} theme={theme} onToggleTheme={toggleTheme} onDemo={openDemo}>
    {content}
    {demoOpen && <DemoModal nodes={nodes} defaultNode={selectedId} onClose={() => setDemoOpen(false)}
      onTriggered={(nodeId) => { setSelectedId(nodeId); }} onReset={() => { setLive({}); refreshAlerts(); refreshNodes(); }} />}
    {signIn && <SignInModal reason={signIn.reason} onClose={() => setSignIn(null)} onSignedIn={setSession} />}
  </Shell>;
}
