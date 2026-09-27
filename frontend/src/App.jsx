import React, { useState, useEffect, useCallback } from "react";
import Header from "./components/Header";
import RiverMap from "./components/RiverMap";
import TelemetryChart from "./components/TelemetryChart";
import AlertFeed from "./components/AlertFeed";
import SpikeControl from "./components/SpikeControl";
import RawDataTable from "./components/RawDataTable";
import { fetchNodes, fetchTopology, fetchNodeReadings, fetchAlerts, fetchStats } from "./services/api";
import { useWebSocket } from "./hooks/useWebSocket";
import { Activity, AlertTriangle, ShieldAlert, Users, Droplets } from "lucide-react";

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [topology, setTopology] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState("NODE_LANGTANG_01");
  const [selectedReadings, setSelectedReadings] = useState([]);
  const [latestTelemetryMap, setLatestTelemetryMap] = useState({});
  const [readingCounter, setReadingCounter] = useState(0);

  // 1. Initial Data Fetch
  const loadInitialData = async () => {
    try {
      const [nodesRes, topoRes, alertsRes, statsRes] = await Promise.allSettled([
        fetchNodes(),
        fetchTopology(),
        fetchAlerts(),
        fetchStats()
      ]);

      const nodesData = nodesRes.status === "fulfilled" ? nodesRes.value : [];
      const topoData = topoRes.status === "fulfilled" ? topoRes.value : null;
      const alertsData = alertsRes.status === "fulfilled" ? alertsRes.value : [];
      const statsData = statsRes.status === "fulfilled" ? statsRes.value : { total_readings: 0 };

      console.log("[+] Initial Data Loaded:", {
        nodes: nodesData.length,
        topology: topoData ? "loaded" : "null",
        alerts: alertsData.length,
        total_readings: statsData.total_readings
      });

      setNodes(nodesData);
      setTopology(topoData);
      setAlerts(alertsData);
      if (statsData && statsData.total_readings !== undefined) {
        setReadingCounter(statsData.total_readings);
      }
      if (nodesData.length > 0) {
        setSelectedNodeId((prev) => prev || nodesData[0].node_id);
      }
    } catch (err) {
      console.error("Initialization error:", err);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // 2. Fetch history for selected node
  const loadNodeReadings = useCallback(async (nodeId) => {
    if (!nodeId) return;
    try {
      const history = await fetchNodeReadings(nodeId, 35);
      setSelectedReadings(history);
    } catch (err) {
      console.error("Failed to load node history:", err);
    }
  }, []);

  useEffect(() => {
    if (selectedNodeId) {
      loadNodeReadings(selectedNodeId);
    }
  }, [selectedNodeId, loadNodeReadings]);

  // 3. WebSocket Real-time Handler
  const handleWebSocketMessage = useCallback((packet) => {
    if (packet.type === "TELEMETRY_UPDATE") {
      const item = packet.data;
      setReadingCounter((prev) => prev + 1);

      // Update node in map
      setLatestTelemetryMap((prev) => ({
        ...prev,
        [item.node_id]: item
      }));

      // Update node risk badge in nodes array
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.node_id === item.node_id
            ? { ...n, current_risk: item.risk_level, latest_reading: item }
            : n
        )
      );

      // If this reading belongs to the currently inspected station, append to chart
      if (item.node_id === selectedNodeId) {
        setSelectedReadings((prev) => {
          const updated = [...prev, item];
          return updated.slice(-35); // Keep last 35 points
        });
      }
    } else if (packet.type === "NEW_ALERTS") {
      const incomingAlerts = packet.data || [];
      setAlerts((prevAlerts) => {
        // Prepend new alerts and filter out duplicate alert_ids
        const existingIds = new Set(prevAlerts.map((a) => a.alert_id));
        const filteredNew = incomingAlerts.filter((a) => !existingIds.has(a.alert_id));
        return [...filteredNew, ...prevAlerts].slice(0, 50);
      });
    }
  }, [selectedNodeId]);

  const { isConnected } = useWebSocket("ws://localhost:8000/ws/stream", handleWebSocketMessage);

  const handleSelectNode = (nodeId) => {
    setSelectedNodeId(nodeId);
  };

  const handleAlertAcknowledged = (alertId) => {
    setAlerts((prev) =>
      prev.map((a) => (a.alert_id === alertId ? { ...a, acknowledged: true } : a))
    );
  };

  const selectedNode = nodes.find((n) => n.node_id === selectedNodeId) || nodes[0];
  const settlements = topology?.settlements || [];

  // Summary Metrics
  const criticalCount = nodes.filter((n) => (latestTelemetryMap[n.node_id]?.risk_level || n.current_risk) === "CRITICAL").length;
  const warningCount = nodes.filter((n) => (latestTelemetryMap[n.node_id]?.risk_level || n.current_risk) === "WARNING").length;
  const activeAlerts = alerts.filter((a) => !a.acknowledged);
  const totalPopulationAtRisk = activeAlerts.reduce((acc, curr) => acc + (curr.population_at_risk || 0), 0);

  return (
    <div className="app-container">
      <Header
        isConnected={isConnected}
        activeAlertCount={activeAlerts.length}
        stationCount={nodes.length}
      />

      <div style={{ padding: "20px 24px 0 24px" }}>
        {/* Viva Demo Spike Control Panel */}
        <SpikeControl
          nodes={nodes}
          onSpikeTriggered={(nodeId) => {
            setSelectedNodeId(nodeId);
          }}
        />

        {/* Quick Metrics Strip */}
        <div className="metrics-strip">
          <div className="metric-card">
            <span className="metric-label">High-Risk Trigger Stations</span>
            <div className="metric-value" style={{ color: criticalCount > 0 ? "#ef4444" : "#10b981" }}>
              {criticalCount} CRITICAL / {warningCount} WARNING
            </div>
            <span className="metric-sub">Evaluated by Module C Anomaly Engine</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Active Downstream Alerts</span>
            <div className="metric-value" style={{ color: activeAlerts.length > 0 ? "#f97316" : "#38bdf8" }}>
              {activeAlerts.length} SETTLEMENTS
            </div>
            <span className="metric-sub">Dijkstra Shortest Arrival Route</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Downstream Population at Risk</span>
            <div className="metric-value" style={{ color: totalPopulationAtRisk > 0 ? "#f87171" : "#f8fafc" }}>
              {totalPopulationAtRisk.toLocaleString()}
            </div>
            <span className="metric-sub">Targeted for Priority Evacuation</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Ingested Telemetry Events</span>
            <div className="metric-value" style={{ color: "#38bdf8" }}>
              {readingCounter} READINGS
            </div>
            <span className="metric-sub">Continuous Real-Time Stream</span>
          </div>
        </div>
      </div>

      {/* Main Operations Grid */}
      <div className="dashboard-content">
        {/* Left Column: River Basin Map + Live Telemetry Chart */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="glass-panel">
            <div className="panel-header">
              <div className="panel-title">
                <Activity size={16} />
                <span>RIVER BASIN GEOGRAPHIC GIS TOPOLOGY</span>
              </div>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                Click station to inspect live sensor telemetry
              </span>
            </div>
            <RiverMap
              nodes={nodes}
              settlements={settlements}
              topology={topology}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
            />
          </div>

          <TelemetryChart
            selectedNode={selectedNode}
            readings={selectedReadings}
          />
        </div>

        {/* Right Column: Cascading Alert Feed & Evacuation Dispatch */}
        <div>
          <AlertFeed
            alerts={alerts}
            onAlertAcknowledged={handleAlertAcknowledged}
          />
        </div>
      </div>

      {/* Audit Log / Raw Data Inspection Table */}
      <div style={{ padding: "0 24px 24px 24px" }}>
        <RawDataTable
          nodes={nodes}
          latestTelemetryMap={latestTelemetryMap}
        />
      </div>
    </div>
  );
}
