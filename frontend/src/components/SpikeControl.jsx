import React, { useState, useEffect } from "react";
import { Zap, Flame, Sliders, AlertTriangle } from "lucide-react";
import { triggerSpike } from "../services/api";

export default function SpikeControl({ nodes, onSpikeTriggered }) {
  const [targetNode, setTargetNode] = useState(nodes[0]?.node_id || "NODE_LANGTANG_01");
  const [surgeCm, setSurgeCm] = useState(150);
  const [isTriggering, setIsTriggering] = useState(false);
  const [lastMsg, setLastMsg] = useState("");

  useEffect(() => {
    if (nodes && nodes.length > 0) {
      if (!targetNode || !nodes.some(n => n.node_id === targetNode)) {
        setTargetNode(nodes[0].node_id);
      }
    }
  }, [nodes, targetNode]);

  const handleTrigger = async () => {
    setIsTriggering(true);
    setLastMsg("");
    try {
      const res = await triggerSpike(targetNode, Number(surgeCm));
      setLastMsg(`Flood spike command dispatched to ${targetNode} (+${surgeCm}cm surge)!`);
      if (onSpikeTriggered) {
        onSpikeTriggered(targetNode);
      }
    } catch (e) {
      setLastMsg(`Failed to trigger spike: ${e.message}`);
    } finally {
      setTimeout(() => setIsTriggering(false), 1500);
    }
  };

  return (
    <div className="spike-control-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#f87171" }}>
          <Flame size={20} />
          <span style={{ fontWeight: 700, letterSpacing: "0.03em", fontSize: "0.92rem" }}>
            VIVA DEMO: FLOOD SPIKE INJECTION
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Target Station:</span>
          <select
            className="spike-select"
            value={targetNode}
            onChange={(e) => setTargetNode(e.target.value)}
          >
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                {n.name} ({n.node_id})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Surge Surge:</span>
          <input
            type="range"
            min="80"
            max="220"
            step="10"
            value={surgeCm}
            onChange={(e) => setSurgeCm(e.target.value)}
            style={{ width: "110px", accentColor: "#ef4444" }}
          />
          <span style={{ fontSize: "0.82rem", fontFamily: "var(--font-mono)", color: "#f87171", fontWeight: 700, width: "55px" }}>
            +{surgeCm}cm
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {lastMsg && (
          <span style={{ fontSize: "0.78rem", color: "#38bdf8", fontFamily: "var(--font-mono)" }}>
            {lastMsg}
          </span>
        )}

        <button
          className="spike-btn"
          onClick={handleTrigger}
          disabled={isTriggering}
        >
          <Zap size={16} />
          <span>{isTriggering ? "DISPATCHING..." : "INJECT FLOOD SPIKE"}</span>
        </button>
      </div>
    </div>
  );
}
