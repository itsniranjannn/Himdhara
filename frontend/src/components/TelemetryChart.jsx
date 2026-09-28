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

export default function TelemetryChart({ selectedNode, readings, latestTelemetryMap = {} }) {
  if (!selectedNode) {
    return (
      <div className="glass-panel" style={{ height: "340px", justifyContent: "center", alignItems: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Select a station on the map or list to view live telemetry.</p>
      </div>
    );
  }

  // Ensure chart points belong to this selected station (relaxed matching so valid historical data is never excluded)
  const stationReadings = (readings || []).filter((r) => {
    if (!r.node_id) return true;
    return String(r.node_id).trim() === String(selectedNode.node_id).trim();
  });

  // Limit chart history to the most recent ~5 minutes of readings relative to the latest point
  // to avoid connecting across large time gaps (e.g. server restart after hours)
  const timestamps = stationReadings
    .map((r) => (r.timestamp ? new Date(r.timestamp).getTime() : NaN))
    .filter((t) => !isNaN(t));

  let recentReadings = stationReadings;
  if (timestamps.length > 0) {
    const latestTime = Math.max(...timestamps);
    const windowMs = 5 * 60 * 1000; // 5 minutes window
    recentReadings = stationReadings.filter((r) => {
      if (!r.timestamp) return true;
      const t = new Date(r.timestamp).getTime();
      return !isNaN(t) && (latestTime - t) <= windowMs;
    });
  }

  // Thresholds from node configuration
  const thresholds = selectedNode.thresholds || {};
  const tWatch = thresholds.water_level_watch || 100;
  const tWarn = thresholds.water_level_warning || 150;
  const tCrit = thresholds.water_level_critical || 200;

  // Resolve live telemetry: prioritize live telemetry map for this specific selected station,
  // then latest station reading from filtered history, then node.latest_reading
  const live =
    latestTelemetryMap[selectedNode.node_id] ||
    (recentReadings.length > 0 ? recentReadings[recentReadings.length - 1] : selectedNode.latest_reading) ||
    {};

  // Format data for recharts
  // If station readings array is empty but live telemetry exists, provide live reading as baseline curve
  const pointsToRender =
    recentReadings.length > 0
      ? recentReadings
      : (live.water_level_cm !== undefined ? [{ ...live, node_id: selectedNode.node_id }] : []);

  const chartData = pointsToRender.map((r, idx) => {
    const timeStr = r.timestamp
      ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : `T-${pointsToRender.length - idx}`;
    return {
      time: timeStr,
      water_level: typeof r.water_level_cm === "number" ? r.water_level_cm : parseFloat(r.water_level_cm) || 0,
      ema: r.ema_water_level !== null && r.ema_water_level !== undefined ? (typeof r.ema_water_level === "number" ? r.ema_water_level : parseFloat(r.ema_water_level)) : undefined,
      rainfall: typeof r.rainfall_mm === "number" ? r.rainfall_mm : parseFloat(r.rainfall_mm) || 0,
      soil: typeof r.soil_moisture_pct === "number" ? r.soil_moisture_pct : parseFloat(r.soil_moisture_pct) || 0,
      hsi: typeof r.hsi_score === "number" ? Number(r.hsi_score.toFixed(2)) : parseFloat(r.hsi_score) || 0,
      rate: typeof r.rate_of_change_cm_min === "number" ? r.rate_of_change_cm_min : parseFloat(r.rate_of_change_cm_min) || 0
    };
  });

  const liveRisk = live.risk_level || selectedNode.current_risk || "NORMAL";

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
          <span className={`badge-risk ${liveRisk}`}>
            {liveRisk}
          </span>
        </div>
      </div>

      {/* Real-time stats chips dynamically bound to selected station */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          Water Level: <b style={{ color: "#38bdf8", fontFamily: "var(--font-mono)" }}>{live.water_level_cm !== undefined ? `${live.water_level_cm} cm` : "--"}</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          EMA Baseline: <b style={{ color: "#34d399", fontFamily: "var(--font-mono)" }}>{live.ema_water_level !== undefined ? `${live.ema_water_level} cm` : "--"}</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          Surge Rate: <b style={{ color: "#fb923c", fontFamily: "var(--font-mono)" }}>{live.rate_of_change_cm_min !== undefined ? `${live.rate_of_change_cm_min} cm/min` : "0.0 cm/min"}</b>
        </div>
        <div style={{ fontSize: "0.76rem", background: "rgba(255,255,255,0.03)", padding: "4px 8px", borderRadius: "6px" }}>
          HSI Stress Score: <b style={{ color: (live.hsi_score ?? 0) >= 3 ? "#f87171" : "#a78bfa", fontFamily: "var(--font-mono)" }}>
            {live.hsi_score !== undefined && live.hsi_score !== null ? Number(live.hsi_score).toFixed(2) : "0.00"}
          </b>
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
              formatter={(value, name) => {
                if (typeof value === "number") {
                  return [value.toFixed(2), name];
                }
                return [value, name];
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
