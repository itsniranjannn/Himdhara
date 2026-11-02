// The API returns UTC timestamps, sometimes without a zone suffix ("2026-10-28 11:15:51").
// A bare string would be parsed as local time and shown hours off, so always treat it as UTC.
export function parseUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = String(value).trim().replace(" ", "T");
  const date = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const nptFull = new Intl.DateTimeFormat("en-NP", { timeZone: "Asia/Kathmandu", hour12: false, dateStyle: "medium", timeStyle: "medium" });
const nptClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour12: false, hour: "2-digit", minute: "2-digit" });
const nptClockSeconds = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function formatNpt(value) {
  const date = parseUtc(value);
  return date ? `${nptFull.format(date)} NPT` : "—";
}

export function formatClock(value, seconds = false) {
  const date = parseUtc(value);
  return date ? (seconds ? nptClockSeconds : nptClock).format(date) : "";
}

export function timeAgo(value, now = Date.now()) {
  const date = parseUtc(value);
  if (!date) return "no data";
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export function formatDuration(startValue, endValue, now = Date.now()) {
  const start = parseUtc(startValue);
  if (!start) return "—";
  const end = endValue ? parseUtc(endValue).getTime() : now;
  const minutes = Math.max(0, Math.round((end - start.getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const OPEN_STATUSES = ["ACTIVE", "ACKNOWLEDGED"];
export const RISK_RANK = { STALE: -1, NORMAL: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 };

// Seconds without a reading before a station is treated as offline (server value overrides this).
export const DEFAULT_STALE_SECONDS = 60;

export function lastSeen(node, live) {
  const stamps = [live?.[node.node_id]?.receivedAt, parseUtc(node.last_reading_at)?.getTime()].filter(Boolean);
  return stamps.length ? Math.max(...stamps) : null;
}

// Effective risk: a station that has gone quiet is STALE, never shown as its last (possibly calm) band.
export function riskOf(node, live, now = Date.now(), staleSeconds = DEFAULT_STALE_SECONDS) {
  const seen = lastSeen(node, live);
  if (!seen || now - seen > staleSeconds * 1000) return "STALE";
  return live?.[node.node_id]?.risk_level || node.latest_reading?.risk_level || node.current_risk || "NORMAL";
}

export function sentenceCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}

export function toNumber(value, digits = 2, fallback = "—") {
  const number = Number(value);
  return value === null || value === undefined || Number.isNaN(number) ? fallback : number.toFixed(digits);
}
