import React from "react";
import { Users, ShieldAlert, CheckCircle2 } from "lucide-react";
import { acknowledgeAlert } from "../services/api";

export default function AlertFeed({ alerts, onAlertAcknowledged }) {
  const handleAcknowledge = async (alertId) => {
    try {
      await acknowledgeAlert(alertId);
      if (onAlertAcknowledged) {
        onAlertAcknowledged(alertId);
      }
    } catch (e) {
      console.error("Failed to acknowledge alert:", e);
    }
  };

  return (
    <div className="glass-panel" style={{ height: "480px" }}>
      <div className="panel-header">
        <div className="panel-title">
          <ShieldAlert size={16} color="#ef4444" />
          <span>GRAPH CASCADED ALERTS (ETA RANKED)</span>
        </div>
        <span style={{ fontSize: "0.76rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {alerts.filter((a) => !a.acknowledged).length} ALERTS ACTIVE
        </span>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--text-muted)" }}>
            <CheckCircle2 size={36} color="#10b981" style={{ margin: "0 auto 10px auto", opacity: 0.8 }} />
            <p style={{ fontWeight: 600, color: "#34d399", fontSize: "0.9rem" }}>No Active Downstream Threats</p>
            <p style={{ fontSize: "0.78rem", marginTop: "4px" }}>
              All river reaches are within normal discharge limits.
            </p>
          </div>
        ) : (
          alerts.map((alert) => {
            const riskClass = alert.risk_level || "WARNING";
            return (
              <div key={alert.alert_id || alert.id} className={`alert-card ${riskClass}`}>
                <div className="alert-header">
                  <div>
                    <div className="alert-settlement">{alert.affected_settlement_name}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
                      Trigger: {alert.source_node_name}
                    </div>
                  </div>

                  <div className="alert-eta-badge">
                    ETA: {alert.eta_minutes}m
                  </div>
                </div>

                <div style={{ fontSize: "0.78rem", color: "#e2e8f0", background: "rgba(0,0,0,0.2)", padding: "6px 8px", borderRadius: "4px" }}>
                  <span style={{ color: "#94a3b8" }}>Evacuate To: </span>
                  <b>{alert.evacuation_zone || "Elevated Ridge Safe Area"}</b>
                </div>

                <div className="alert-meta">
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <Users size={13} />
                    <span>Pop: {(alert.population_at_risk || 0).toLocaleString()}</span>
                  </div>

                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span className={`badge-risk ${riskClass}`} style={{ fontSize: "0.68rem", padding: "2px 6px" }}>
                      {riskClass}
                    </span>
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.alert_id)}
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "#cbd5e1",
                          borderRadius: "4px",
                          padding: "3px 8px",
                          fontSize: "0.7rem",
                          cursor: "pointer"
                        }}
                      >
                        ACK
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
