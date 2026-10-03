import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// Automatically calls fitBounds on all station coordinates on initial load so the full basin is visible
function AutoFitBounds({ nodes, settlements }) {
  const map = useMap();
  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (hasFittedRef.current) return;

    const stationCoords = (nodes || [])
      .filter((n) => n.lat && n.lng)
      .map((n) => [n.lat, n.lng]);

    const settlementCoords = (settlements || [])
      .filter((s) => s.lat && s.lng)
      .map((s) => [s.lat, s.lng]);

    const allCoords = [...stationCoords, ...settlementCoords];

    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords);
      map.fitBounds(bounds, {
        padding: [25, 25],
        maxZoom: 12
      });
      hasFittedRef.current = true;
    }
  }, [nodes, settlements, map]);

  return null;
}

// Helper to create custom SVG div icons based on station risk status
function createStationIcon(riskLevel, isSelected) {
  const colorMap = {
    NORMAL: "#10b981",
    WATCH: "#f59e0b",
    WARNING: "#f97316",
    CRITICAL: "#ef4444"
  };
  const color = colorMap[riskLevel] || "#10b981";
  const isCritical = riskLevel === "CRITICAL";

  const html = `
    <div style="
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
    ">
      ${isCritical ? `
        <div style="
          position: absolute;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 2px solid ${color};
          animation: pulse-ring 1.2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
        "></div>
      ` : ""}
      <div style="
        width: ${isSelected ? "22px" : "18px"};
        height: ${isSelected ? "22px" : "18px"};
        background: ${color};
        border-radius: 50%;
        border: 2px solid #ffffff;
        box-shadow: 0 0 0 3px color-mix(in srgb, ${color} 22%, transparent);
        transition: all 0.2s;
      "></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "custom-station-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function createSettlementIcon() {
  const html = `
    <div style="
      background: #2c8fa0;
      border: 2px solid #eaf8f7;
      border-radius: 4px;
      width: 14px;
      height: 14px;
      transform: rotate(45deg);
      box-shadow: 0 0 0 3px rgba(44, 143, 160, 0.2);
    "></div>
  `;
  return L.divIcon({
    html,
    className: "custom-settlement-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

export default function RiverMap({ nodes, settlements, topology, selectedNodeId, onSelectNode, latestTelemetryMap = {}, theme = "dark" }) {
  // Center roughly on Langtang - Trishuli basin (Lat: 28.08, Lng: 85.32)
  const centerPosition = [28.06, 85.32];

  // Build reach polylines from topology
  const reaches = [];
  if (topology && topology.nodes) {
    const nodeCoords = {};
    topology.nodes.forEach(n => {
      nodeCoords[n.node_id] = [n.lat, n.lng];
    });
    (topology.settlements || []).forEach(s => {
      nodeCoords[s.settlement_id] = [s.lat, s.lng];
    });

    topology.nodes.forEach(n => {
      const from = [n.lat, n.lng];
      (n.downstream_targets || []).forEach(t => {
        const to = nodeCoords[t.target_id];
        if (to) {
          reaches.push({
            id: `${n.node_id}->${t.target_id}`,
            from,
            to,
            type: t.type,
            travelTime: t.travel_time_min
          });
        }
      });
    });
  }

  return (
    <div className={`map-container-wrapper ${theme}`}>
      <MapContainer
        center={centerPosition}
        zoom={10}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Auto fit all station & settlement coordinates on initial load */}
        <AutoFitBounds nodes={nodes} settlements={settlements} />

        {/* Draw River reaches & flow paths */}
        {reaches.map((reach) => (
          <Polyline
            key={reach.id}
            positions={[reach.from, reach.to]}
            pathOptions={{
              color: reach.type === "settlement" ? "#5fb9c3" : "#2c8fa0",
              weight: reach.type === "settlement" ? 2 : 4,
              opacity: 0.7,
              dashArray: reach.type === "settlement" ? "4, 6" : undefined
            }}
          />
        ))}

        {/* Sensor Node Markers */}
        {nodes.map((node) => {
          const isSelected = node.node_id === selectedNodeId;
          const live = latestTelemetryMap[node.node_id] || node.latest_reading || {};
          const risk = live.risk_level || node.current_risk || "NORMAL";
          const icon = createStationIcon(risk, isSelected);

          return (
            <Marker
              key={node.node_id}
              position={[node.lat, node.lng]}
              icon={icon}
              eventHandlers={{
                click: () => onSelectNode(node.node_id)
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="map-popup-content" style={{ fontSize: "0.85rem", minWidth: "160px" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{node.name}</div>
                  <div style={{ color: "var(--text-3)", fontSize: "0.78rem", marginBottom: "6px" }}>
                    ID: {node.node_id} | Elev: {node.elevation_m}m
                  </div>
                  <div>Status: <b>{risk}</b></div>
                  {(live.water_level_cm !== undefined || live.rate_of_change_cm_min !== undefined || live.hsi_score !== undefined) && (
                    <div style={{ marginTop: "4px", fontSize: "0.8rem", borderTop: "1px solid #cbd5e1", paddingTop: "4px" }}>
                      <div>Water: <b>{live.water_level_cm ?? "--"} cm</b></div>
                      <div>Rate: <b>{live.rate_of_change_cm_min ?? "--"} cm/min</b></div>
                      <div>HSI Score: <b>{live.hsi_score !== undefined && live.hsi_score !== null ? Number(live.hsi_score).toFixed(2) : "--"}</b></div>
                      <div>Rainfall: <b>{live.rainfall_mm ?? "--"} mm</b></div>
                      <div>Soil Sat: <b>{live.soil_moisture_pct ?? "--"} %</b></div>
                    </div>
                  )}
                  <button
                    onClick={() => onSelectNode(node.node_id)}
                    style={{
                      marginTop: "8px",
                    background: "var(--brand)",
                      color: "white",
                      border: "none",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      width: "100%",
                      fontSize: "0.75rem"
                    }}
                  >
                    Inspect Telemetry
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Downstream Inhabited Settlement Markers */}
        {settlements.map((settle) => {
          const icon = createSettlementIcon();
          return (
            <Marker
              key={settle.settlement_id}
              position={[settle.lat, settle.lng]}
              icon={icon}
            >
              <Popup>
                <div style={{ color: "#0f172a", fontSize: "0.85rem", minWidth: "180px" }}>
                  <div style={{ fontWeight: 700, color: "#1d4ed8" }}>{settle.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                    Population: <b>{(settle.population || 0).toLocaleString()}</b>
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "0.76rem" }}>
                    Evacuation Zone: <br/>
                    <span style={{ color: "#047857", fontWeight: 600 }}>{settle.evacuation_zone}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
