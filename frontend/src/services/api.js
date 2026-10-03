const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api";
export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

async function request(url, options = {}) {
  const session = localStorage.getItem("trishuli-session");
  const headers = new Headers(options.headers || {});
  if (session) {
    try {
      const { access_token: token } = JSON.parse(session);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      localStorage.removeItem("trishuli-session");
    }
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("trishuli-session");
    window.dispatchEvent(new CustomEvent("trishuli-session-expired"));
  }
  return res;
}

export async function fetchNodes() {
  const res = await request(`${API_BASE}/nodes`);
  if (!res.ok) throw new Error("Failed to fetch nodes");
  return res.json();
}

export async function fetchTopology() {
  const res = await request(`${API_BASE}/network/topology`);
  if (!res.ok) throw new Error("Failed to fetch topology");
  return res.json();
}

export async function fetchStats() {
  const res = await request(`${API_BASE}/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchNodeReadings(nodeId, limit = 40) {
  const res = await request(`${API_BASE}/nodes/${nodeId}/readings?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch readings for ${nodeId}`);
  return res.json();
}

export async function fetchAlerts(activeOnly = false) {
  const res = await request(`${API_BASE}/alerts?active_only=${activeOnly}`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

export async function fetchIncidents() {
  const res = await request(`${API_BASE}/incidents`);
  if (!res.ok) throw new Error("Failed to fetch incidents");
  return res.json();
}

export async function fetchSettlements() {
  const res = await request(`${API_BASE}/settlements`);
  if (!res.ok) throw new Error("Failed to fetch settlements");
  return res.json();
}

export async function updateThresholds(nodeId, thresholds) {
  const res = await request(`${API_BASE}/nodes/${nodeId}/thresholds`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(thresholds)
  });
  if (!res.ok) throw new Error("Failed to update thresholds");
  return res.json();
}

export async function updateSettlement(settlementId, values) {
  const res = await request(`${API_BASE}/settlements/${settlementId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values)
  });
  if (!res.ok) throw new Error("Failed to update settlement");
  return res.json();
}

export async function triggerSpike(nodeId, waterSurge = 145.0, rainSurge = 80.0) {
  const res = await request(`${API_BASE}/spike/inject`, {
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

export async function login(username, password) {
  const res = await request(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error("Invalid username or password");
  return res.json();
}

export async function acknowledgeAlert(alertId) {
  const res = await request(`${API_BASE}/alerts/${alertId}/acknowledge`, {
    method: "POST"
  });
  return res.json();
}
