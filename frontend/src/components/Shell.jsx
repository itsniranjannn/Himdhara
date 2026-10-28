import React from "react";
import { Bell, BarChart3, History, LayoutGrid, MapPin, Moon, SlidersHorizontal, Sun } from "lucide-react";
import Logo from "./Logo";
import { lastSeen, timeAgo } from "../lib/format";
import { OfflineBanner } from "./ui";

const NAV = [
  ["/app/monitor", "Monitor", "Monitor", LayoutGrid],
  ["/app/alerts", "Alerts", "Alerts", Bell],
  ["/app/analytics", "Analytics", "Analytics", BarChart3],
  ["/app/incidents", "Incidents", "Incidents", History],
  ["/app/configuration", "Configuration", "Setup", SlidersHorizontal],
  ["/bulletin", "Public bulletin", "Bulletin", MapPin],
];
const TITLES = { "/app/monitor": "Monitor", "/app/alerts": "Alerts", "/app/analytics": "Analytics", "/app/incidents": "Incidents", "/app/configuration": "Configuration" };

export function ThemeToggle({ theme, onToggle }) {
  const next = theme === "dark" ? "light" : "dark";
  return <button className="demo-button icon-button" onClick={onToggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>;
}

export default function Shell({ page, navigate, children, health, healthError, isConnected, nodes, live, now, openAlerts, session, onSignIn, onSignOut, theme, onToggleTheme, onDemo }) {
  const seen = nodes.map((node) => lastSeen(node, live)).filter(Boolean);
  const newest = seen.length ? Math.max(...seen) : null;
  const mqttOk = health?.mqtt_connected;
  return <div className="shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><Logo variant="full" /></div>
      <nav aria-label="Primary">{NAV.map(([path, label, short, Icon]) => <a key={path} href={path} aria-current={page === path ? "page" : undefined} className={page === path ? "nav-item active" : "nav-item"} onClick={(event) => { event.preventDefault(); navigate(path); }}><Icon size={16} /><span className="nav-label">{label}</span><span className="nav-short">{short}</span></a>)}</nav>
      <div className="sidebar-footer"><span className={`status-dot ${session?.role === "operator" ? "operator" : ""}`} />{session ? `${session.username} · ${session.role}` : "Signed out · read-only"}</div>
    </aside>
    <main className="content">
      <header className="topbar">
        <h1>{TITLES[page] || "Dashboard"}</h1>
        <div className="top-status">
          <span title={health ? `Broker ${health.mqtt_broker}` : "Waiting for the server"}><i className={mqttOk ? "connected-dot" : health ? "bad-dot" : ""} /> MQTT {mqttOk ? "connected" : health ? "disconnected" : "unknown"}</span>
          <span><i className={isConnected ? "connected-dot" : "bad-dot"} /> Live {isConnected ? "stream on" : "reconnecting"}</span>
          <span className="last-reading">Last reading {newest ? timeAgo(newest, now) : "—"}</span>
          <span className={openAlerts ? "open-alerts has" : "open-alerts"}><Bell size={14} /> {openAlerts} open</span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {health?.demo_controls_enabled && <button className="demo-button" onClick={onDemo}>Demo</button>}
          {session
            ? <span className="user-chip"><span className="avatar">{session.username[0].toUpperCase()}</span><strong>{session.username}</strong><small>{session.role}</small><button className="signout-button" onClick={onSignOut}>Sign out</button></span>
            : <button className="demo-button" onClick={onSignIn}>Sign in</button>}
        </div>
      </header>
      {healthError && <OfflineBanner message={`${healthError} Showing the last data received.`} />}
      <div key={page} className="route-transition">{children}</div>
    </main>
  </div>;
}
