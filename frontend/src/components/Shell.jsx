import React from "react";
import { Bell, BarChart3, History, LayoutGrid, MapPin, Moon, SlidersHorizontal, Sun } from "lucide-react";
import Logo from "./Logo";
import { lastSeen, timeAgo } from "../lib/format";
import { OfflineBanner } from "./ui";

const NAV = [
  ["/app/monitor", "Monitor", LayoutGrid],
  ["/app/alerts", "Alerts", Bell],
  ["/app/analytics", "Analytics", BarChart3],
  ["/app/incidents", "Incidents", History],
  ["/app/configuration", "Setup", SlidersHorizontal],
  ["/bulletin", "Bulletin", MapPin],
];

export function ThemeToggle({ theme, onToggle }) {
  const next = theme === "dark" ? "light" : "dark";
  return <button className="demo-button icon-button" onClick={onToggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>;
}

// Basin picker shown as a prominent pill in the app bar.
export function BasinSwitcher({ basins, basin, onChange, id = "basin-select" }) {
  if (!basins.length) return null;
  return <div className="basin-pill">
    <label htmlFor={id}>Basin</label>
    <select id={id} value={basin?.basin_id || ""} onChange={(event) => onChange(event.target.value)}>
      {basins.map((item) => <option key={item.basin_id} value={item.basin_id}>{item.name}{item.open_alerts ? ` · ${item.open_alerts} open` : ""}</option>)}
    </select>
    {basin?.open_alerts > 0 && <span className="pill-dot" aria-hidden="true" />}
  </div>;
}

export default function Shell({ page, navigate, children, health, healthError, isConnected, nodes, live, now, openAlerts, session, onSignIn, onSignOut, theme, onToggleTheme, onDemo, basins, basin, onBasinChange }) {
  const seen = nodes.map((node) => lastSeen(node, live)).filter(Boolean);
  const newest = seen.length ? Math.max(...seen) : null;
  const mqttOk = health?.mqtt_connected;
  const state = healthError ? "offline" : mqttOk && isConnected ? "live" : "connecting";
  const stateText = { live: "Live", connecting: "Connecting", offline: "Offline" }[state];
  return <div className="app">
    <header className="appbar">
      <a className="appbar-brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} aria-label="Home"><Logo variant="full" /></a>
      <nav className="appbar-nav" aria-label="Primary">
        {NAV.map(([path, label, Icon]) => <a key={path} href={path} aria-current={page === path ? "page" : undefined} className={page === path ? "nav-item active" : "nav-item"} onClick={(event) => { event.preventDefault(); navigate(path); }}>
          <Icon size={16} /><span>{label}</span>{path === "/app/alerts" && openAlerts > 0 && <b className="nav-badge">{openAlerts}</b>}
        </a>)}
      </nav>
      <div className="appbar-right">
        <BasinSwitcher basins={basins} basin={basin} onChange={onBasinChange} />
        <span className={`live-pill ${state}`} title={`MQTT ${mqttOk ? "connected" : health ? "disconnected" : "unknown"} · stream ${isConnected ? "on" : "reconnecting"}${newest ? ` · last reading ${timeAgo(newest, now)}` : ""}`}>
          <i /> {stateText}{newest && state === "live" && <small className="last-reading">{timeAgo(newest, now)}</small>}
        </span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {health?.demo_controls_enabled && <button className="demo-button demo-trigger" onClick={onDemo}>Demo</button>}
        {session
          ? <span className="user-chip"><span className="avatar">{session.username[0].toUpperCase()}</span><strong>{session.username}</strong><small>{session.role}</small><button className="signout-button" onClick={onSignOut}>Sign out</button></span>
          : <button className="demo-submit small signin-button" onClick={onSignIn}>Sign in</button>}
      </div>
    </header>
    {healthError && <OfflineBanner message={`${healthError} Showing the last data received.`} />}
    <main className="canvas"><div key={page} className="route-transition">{children}</div></main>
    <nav className="bottom-nav" aria-label="Primary mobile">
      {NAV.map(([path, label, Icon]) => <a key={path} href={path} aria-current={page === path ? "page" : undefined} className={page === path ? "nav-item active" : "nav-item"} onClick={(event) => { event.preventDefault(); navigate(path); }}><Icon size={18} /><span>{label}</span></a>)}
    </nav>
  </div>;
}
