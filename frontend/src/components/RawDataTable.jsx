import React from "react";
import { Database } from "lucide-react";

export default function RawDataTable({ nodes, latestTelemetryMap, selectedNodeId, onSelectNode }) {
  return (
    <div className="glass-panel" style={{ marginTop: "20px" }}>
      <div className="panel-header">
        <div className="panel-title">
          <Database size={16} />
          <span>REAL-TIME SENSOR TELEMETRY & ALGORITHM AUDIT LOG</span>
        </div>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          MODULE C ANALYTICAL VERIFICATION • CLICK ROW TO INSPECT
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
              <th style={{ padding: "8px 12px" }}>Station ID</th>
              <th style={{ padding: "8px 12px" }}>Location Name</th>
              <th style={{ padding: "8px 12px" }}>Water Level</th>
              <th style={{ padding: "8px 12px" }}>EMA Baseline</th>
              <th style={{ padding: "8px 12px" }}>Surge Rate</th>
              <th style={{ padding: "8px 12px" }}>Rainfall</th>
              <th style={{ padding: "8px 12px" }}>Soil Sat.</th>
              <th style={{ padding: "8px 12px" }}>HSI Score</th>
              <th style={{ padding: "8px 12px" }}>Classification</th>
              <th style={{ padding: "8px 12px" }}>Analytical Justification</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)", fontStyle: "italic" }}>
                  Connecting to telemetry stream and loading monitoring stations...
                </td>
              </tr>
            ) : (
              nodes.map((n) => {
                const live = latestTelemetryMap[n.node_id] || n.latest_reading || {};
                const risk = live.risk_level || n.current_risk || "NORMAL";
                const isSelected = n.node_id === selectedNodeId;

                return (
                  <tr
                    key={n.node_id}
                    onClick={() => onSelectNode && onSelectNode(n.node_id)}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      background: isSelected
                        ? "rgba(56, 189, 248, 0.12)"
                        : risk === "CRITICAL"
                        ? "rgba(239, 68, 68, 0.08)"
                        : "transparent",
                      cursor: onSelectNode ? "pointer" : "default",
                      transition: "background 0.15s"
                    }}
                  >
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", color: isSelected ? "#38bdf8" : "var(--accent-cyan)", fontWeight: isSelected ? 700 : 400 }}>
                    {isSelected ? `▶ ${n.node_id}` : n.node_id}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{n.name}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)" }}>
                    {live.water_level_cm !== undefined ? `${Number(live.water_level_cm).toFixed(2)} cm` : "--"}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", color: "#34d399" }}>
                    {live.ema_water_level !== undefined ? `${Number(live.ema_water_level).toFixed(2)} cm` : "--"}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", color: "#fb923c" }}>
                    {live.rate_of_change_cm_min ? `${live.rate_of_change_cm_min} cm/m` : "0.0"}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)" }}>
                    {live.rainfall_mm ? `${live.rainfall_mm} mm` : "--"}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)" }}>
                    {live.soil_moisture_pct ? `${live.soil_moisture_pct}%` : "--"}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                    {live.hsi_score !== undefined && live.hsi_score !== null
                      ? Number(live.hsi_score).toFixed(2)
                      : "--"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className={`badge-risk ${risk}`}>{risk}</span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "0.74rem", color: "var(--text-secondary)", maxWidth: "240px" }}>
                    {live.reason || "Within baseline hydrological limits"}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
