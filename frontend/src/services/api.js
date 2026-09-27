const API_BASE = "http://localhost:8000/api";

export async function fetchNodes() {
  const res = await fetch(`${API_BASE}/nodes`);
  if (!res.ok) throw new Error("Failed to fetch nodes");
  return res.json();
}

export async function fetchTopology() {
  const res = await fetch(`${API_BASE}/network/topology`);
  if (!res.ok) throw new Error("Failed to fetch topology");
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchNodeReadings(nodeId, limit = 40) {
  const res = await fetch(`${API_BASE}/nodes/${nodeId}/readings?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch readings for ${nodeId}`);
  return res.json();
}

export async function fetchAlerts(activeOnly = false) {
  const res = await fetch(`${API_BASE}/alerts?active_only=${activeOnly}`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

export async function triggerSpike(nodeId, waterSurge = 145.0, rainSurge = 80.0) {
  const res = await fetch(`${API_BASE}/spike/inject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_id: nodeId,
      water_level_surge_cm: waterSurge,
      rainfall_surge_mm: rainSurge,
      soil_moisture_surge_pct: 40.0,
      duration_seconds: 45
    })
  });
  if (!res.ok) throw new Error("Failed to trigger spike");
  return res.json();
}

export async function acknowledgeAlert(alertId) {
  const res = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
    method: "POST"
  });
  return res.json();
}
