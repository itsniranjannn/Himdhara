import React, { useState, useEffect } from "react";
import { Activity, AlertTriangle, ShieldCheck, Waves } from "lucide-react";

export default function Header({ isConnected, activeAlertCount, stationCount }) {
  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="dashboard-header">
      <div className="brand-section">
        <div className="brand-logo">
          <Waves size={24} />
        </div>
        <div>
          <h1 className="brand-title">TRISHULI EARLY WARNING & ALERT ROUTING</h1>
          <div className="brand-subtitle">
            <span>Himalayan Watershed Hydrological Operations</span>
            <span>•</span>
            <span>Trishuli / Bhotekoshi Basin, Nepal</span>
          </div>
        </div>
      </div>

      <div className="header-status">
        <div className="status-chip">
          <Activity size={14} color="#38bdf8" />
          <span>STATIONS: {stationCount}</span>
        </div>

        <div className="status-chip" style={{ borderColor: activeAlertCount > 0 ? "rgba(239, 68, 68, 0.4)" : "var(--border-subtle)" }}>
          {activeAlertCount > 0 ? (
            <>
              <AlertTriangle size={14} color="#ef4444" />
              <span style={{ color: "#f87171", fontWeight: 700 }}>ACTIVE ALERTS: {activeAlertCount}</span>
            </>
          ) : (
            <>
              <ShieldCheck size={14} color="#10b981" />
              <span style={{ color: "#34d399" }}>SYSTEM NOMINAL</span>
            </>
          )}
        </div>

        <div className="status-chip">
          <span className={`live-dot ${isConnected ? "" : "offline"}`}></span>
          <span>{isConnected ? "WEBSOCKET LIVE" : "DISCONNECTED"}</span>
        </div>

        <div className="status-chip" style={{ color: "var(--text-secondary)" }}>
          <span>{timeStr}</span>
        </div>
      </div>
    </header>
  );
}
