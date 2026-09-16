import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Area,
  ComposedChart
} from "recharts";
import { TrendingUp, Activity, Droplets } from "lucide-react";

export default function TelemetryChart({ selectedNode, readings }) {
  if (!selectedNode) {
    return (
      <div className="glass-panel" style={{ height: "340px", justifyContent: "center", alignItems: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Select a station on the map or list to view live telemetry.</p>
      </div>
    );
  }

  // Thresholds from node configuration
  const thresholds = selectedNode.thresholds || {};
  const tWatch = thresholds.water_level_watch || 100;
  const tWarn = thresholds.water_level_warning || 150;
  const tCrit = thresholds.water_level_critical || 200;

  // Format data for recharts
  const chartData = (readings || []).map((r, idx) => {
    const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : `T-${readings.length - idx}`;
    return {
      time: timeStr,
      water_level: r.water_level_cm,
      ema: r.ema_water_level,
      rainfall: r.rainfall_mm,
      soil: r.soil_moisture_pct,
      hsi: r.hsi_score,
      rate: r.rate_of_change_cm_min
    };
  });

  const latest = readings && readings.length > 0 ? readings[readings.length - 1] : selectedNode.latest_reading || {};

  return (
    <div className="glass-panel" style={{ height: "340px" }}>
      <div className="panel-header">
        <div>
          <div className="panel-title">
            <TrendingUp size={16} />
            <span>LIVE HYDROLOGICAL TELEMETRY: {selectedNode.name}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
            Station ID: <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent-cyan)" }}>{selectedNode.node_id}</code> | Elev: {selectedNode.elevation_m}m
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className={`badge-risk ${selectedNode.current_risk || "NORMAL"}`}>
            {selectedNode.current_risk || "NORMAL"}
          </span>
        </div>
      </div>

      {/* Real-time stats chips */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          Water Level: <b style={{ color: "#38bdf8", fontFamily: "var(--font-mono)" }}>{latest.water_level_cm ?? "--"} cm</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          EMA Baseline: <b style={{ color: "#34d399", fontFamily: "var(--font-mono)" }}>{latest.ema_water_level ?? "--"} cm</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          Surge Rate: <b style={{ color: "#fb923c", fontFamily: "var(--font-mono)" }}>{latest.rate_of_change_cm_min ?? "0.0"} cm/min</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          HSI Stress Score: <b style={{ color: latest.hsi_score >= 3 ? "#f87171" : "#a78bfa", fontFamily: "var(--font-mono)" }}>{latest.hsi_score ?? "0.0"}</b>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
            <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#334155",
                borderRadius: "8px",
                fontSize: "0.8rem"
              }}
            />

            {/* Threshold Reference Lines */}
            <ReferenceLine y={tWatch} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: `Watch (${tWatch}cm)`, fill: '#f59e0b', fontSize: 10 }} />
            <ReferenceLine y={tWarn} stroke="#f97316" strokeDasharray="3 3" label={{ value: `Warning (${tWarn}cm)`, fill: '#f97316', fontSize: 10 }} />
            <ReferenceLine y={tCrit} stroke="#ef4444" strokeDasharray="3 3" label={{ value: `Critical (${tCrit}cm)`, fill: '#ef4444', fontSize: 10 }} />

            {/* EMA Line */}
            <Line
              type="monotone"
              dataKey="ema"
              name="EMA Baseline"
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />

            {/* Actual Water Level Line */}
            <Line
              type="monotone"
              dataKey="water_level"
              name="Water Level (cm)"
              stroke="#38bdf8"
              strokeWidth={3}
              dot={{ r: 3, fill: "#38bdf8" }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
