import React from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, WifiOff } from "lucide-react";

export function Stat({ value, label, tone }) {
  return <div className={`stat ${tone || ""}`}><strong>{value}</strong><span>{label}</span></div>;
}

export function RiskLabel({ risk, label }) {
  return <span className={`risk-label ${risk}`}><i /> {label || (risk === "STALE" ? "OFFLINE" : risk)}</span>;
}

export function EmptyState({ icon: Icon = CheckCircle2, children }) {
  return <div className="empty-state"><Icon size={18} /><span>{children}</span></div>;
}

export function Loading({ label = "Loading…" }) {
  return <div className="empty-state loading" role="status"><LoaderCircle size={18} className="spin" /><span>{label}</span></div>;
}

export function Banner({ tone = "info", icon: Icon = CircleAlert, children, action }) {
  return <div className={`banner ${tone}`} role={tone === "error" ? "alert" : "status"}><Icon size={16} /><span>{children}</span>{action}</div>;
}

export function OfflineBanner({ message }) {
  return <Banner tone="error" icon={WifiOff}>{message}</Banner>;
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Tabs({ tabs, value, onChange, label }) {
  return <div className="alert-tabs" role="tablist" aria-label={label}>
    {tabs.map(([id, text, count]) => <button key={id} role="tab" aria-selected={value === id} className={value === id ? "tab current" : "tab"} onClick={() => onChange(id)}>{text}{count !== undefined && <b>{count}</b>}</button>)}
  </div>;
}
