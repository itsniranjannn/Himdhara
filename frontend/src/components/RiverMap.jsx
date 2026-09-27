import React from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import { MapPin, AlertCircle, Home } from "lucide-react";

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
        box-shadow: 0 0 12px ${color};
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
      background: #3b82f6;
      border: 2px solid #ffffff;
      border-radius: 4px;
      width: 14px;
      height: 14px;
      transform: rotate(45deg);
      box-shadow: 0 0 8px rgba(59, 130, 246, 0.8);
    "></div>
  `;
  return L.divIcon({
    html,
    className: "custom-settlement-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

export default function RiverMap({ nodes, settlements, topology, selectedNodeId, onSelectNode }) {
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
    <div className="map-container-wrapper">
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

        {/* Draw River reaches & flow paths */}
        {reaches.map((reach) => (
          <Polyline
            key={reach.id}
            positions={[reach.from, reach.to]}
            pathOptions={{
              color: reach.type === "settlement" ? "#60a5fa" : "#0284c7",
              weight: reach.type === "settlement" ? 2 : 4,
              opacity: 0.7,
              dashArray: reach.type === "settlement" ? "4, 6" : undefined
            }}
          />
        ))}

        {/* Sensor Node Markers */}
        {nodes.map((node) => {
          const isSelected = node.node_id === selectedNodeId;
          const risk = node.current_risk || "NORMAL";
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
                <div style={{ color: "#0f172a", fontSize: "0.85rem", minWidth: "160px" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{node.name}</div>
                  <div style={{ color: "#475569", fontSize: "0.78rem", marginBottom: "6px" }}>
                    ID: {node.node_id} | Elev: {node.elevation_m}m
                  </div>
                  <div>Status: <b>{risk}</b></div>
                  {node.latest_reading && (
                    <div style={{ marginTop: "4px", fontSize: "0.8rem", borderTop: "1px solid #cbd5e1", paddingTop: "4px" }}>
                      <div>Water: <b>{node.latest_reading.water_level_cm} cm</b></div>
                      <div>Rainfall: <b>{node.latest_reading.rainfall_mm} mm</b></div>
                      <div>Soil Sat: <b>{node.latest_reading.soil_moisture_pct} %</b></div>
                    </div>
                  )}
                  <button
                    onClick={() => onSelectNode(node.node_id)}
                    style={{
                      marginTop: "8px",
                      background: "#0284c7",
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
