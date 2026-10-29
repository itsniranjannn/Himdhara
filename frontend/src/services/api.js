const HOST = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
export const API_BASE = import.meta.env.VITE_API_BASE || `http://${HOST}:8000/api`;
export const WS_URL = import.meta.env.VITE_WS_URL || `ws://${HOST}:8000/ws/stream`;
const SESSION_KEY = "trishuli-session";

function authHeader() {
  try {
    const token = JSON.parse(localStorage.getItem(SESSION_KEY))?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return {};
  }
}

function describeError(body, status) {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) return detail.map((item) => item.msg).join("; ");
  return `Request failed (${status})`;
}

async function request(path, { method = "GET", body, raw = false } = {}) {
  const headers = { ...authHeader() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("Cannot reach the server. Check that the backend is running.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    // A rejected token means the session ended; an anonymous 401 just means sign-in is needed.
    if (response.status === 401 && headers.Authorization) {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new CustomEvent("trishuli-session-expired"));
    }
    throw Object.assign(new Error(describeError(payload, response.status)), { status: response.status });
  }
  return raw ? response : response.json();
}

async function download(path, filename) {
  const response = await request(path, { raw: true });
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

const query = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
  return search.size ? `?${search}` : "";
};

export const fetchHealth = () => request("/health");
export const fetchBasins = () => request("/basins");
export const fetchWeather = (basinId) => request(`/basins/${basinId}/weather`);
export const fetchNodes = () => request("/nodes");
export const fetchTopology = (basin) => request(`/network/topology${query({ basin })}`);
export const fetchStats = () => request("/stats");
export const fetchNodeReadings = (nodeId, { limit = 60, hours } = {}) => request(`/nodes/${nodeId}/readings${query({ limit, hours })}`);
export const fetchForecast = (nodeId) => request(`/nodes/${nodeId}/forecast`);
export const fetchAnalytics = (hours, basin) => request(`/analytics/summary${query({ hours, basin })}`);
export const fetchAlerts = ({ status, limit = 200 } = {}) => request(`/alerts${query({ status, limit })}`);
export const fetchAlertHistory = (alertId) => request(`/alerts/${alertId}/history`);
export const acknowledgeAlert = (alertId, note) => request(`/alerts/${alertId}/acknowledge`, { method: "POST", body: { note: note || null } });
export const resolveAlert = (alertId, note) => request(`/alerts/${alertId}/resolve`, { method: "POST", body: { note: note || null } });
export const fetchIncidents = () => request("/incidents");
export const exportIncidents = () => download("/incidents/export.csv", "incidents.csv");
export const exportReadings = (nodeId, hours) => download(`/readings/export.csv${query({ node_id: nodeId, hours })}`, "readings.csv");
export const fetchSettlements = () => request("/settlements");
export const updateThresholds = (nodeId, thresholds) => request(`/nodes/${nodeId}/thresholds`, { method: "PUT", body: thresholds });
export const updateSettlement = (settlementId, values) => request(`/settlements/${settlementId}`, { method: "PUT", body: values });
export const fetchContacts = () => request("/contacts");
export const addContact = (contact) => request("/contacts", { method: "POST", body: contact });
export const deleteContact = (contactId) => request(`/contacts/${contactId}`, { method: "DELETE" });
export const fetchNotifications = () => request("/notifications/log?limit=100");
export const subscribePublic = (settlementId, phone, language) => request("/public/subscribe", { method: "POST", body: { settlement_id: settlementId, phone, language } });
export const triggerSpike = (nodeId, waterSurge = 145) => request("/spike/inject", { method: "POST", body: { node_id: nodeId, water_level_surge_cm: waterSurge, rainfall_surge_mm: 80, soil_moisture_surge_pct: 40, duration_seconds: 45 } });
export const resetSimulation = () => request("/simulation/reset", { method: "POST" });
export const login = (username, password) => request("/auth/login", { method: "POST", body: { username, password } });
