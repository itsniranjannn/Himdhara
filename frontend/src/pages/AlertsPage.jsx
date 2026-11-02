import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Clock3, LogIn, MapPin, Users } from "lucide-react";
import Modal from "../components/Modal";
import { Banner, EmptyState, Loading, Tabs } from "../components/ui";
import { OPEN_STATUSES, formatNpt } from "../lib/format";
import { acknowledgeAlert, fetchAlertHistory, fetchNotifications, resolveAlert } from "../services/api";

function NoteModal({ action, alert, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verb = action === "acknowledge" ? "Acknowledge" : "Resolve";
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await (action === "acknowledge" ? acknowledgeAlert : resolveAlert)(alert.alert_id, note.trim());
      onDone();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }
  return <Modal title={`${verb} alert`} description={`${alert.affected_settlement_name} · ${alert.risk_level}`} onClose={onClose} onSubmit={submit}>
    <label className="field"><span>Note (optional)</span><textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "acknowledge" ? "e.g. Ward office informed, team dispatched" : "e.g. River receded, area safe"} /></label>
    {error && <p className="form-error">{error}</p>}
    <button className="demo-submit" disabled={busy}>{busy ? "Saving…" : verb}</button>
  </Modal>;
}

function History({ alertId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { fetchAlertHistory(alertId).then(setRows).catch((failure) => setError(failure.message)); }, [alertId]);
  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return <Loading label="Loading history…" />;
  if (!rows.length) return <p className="muted small">No operator actions yet.</p>;
  return <ol className="history-list">{rows.map((row) => <li key={row.id}><b>{row.from_status} → {row.to_status}</b><span>{row.changed_by} · {formatNpt(row.changed_at)}</span>{row.note && <em>“{row.note}”</em>}</li>)}</ol>;
}

function AlertRow({ alert, canOperate, onAction }) {
  const [open, setOpen] = useState(false);
  const status = alert.status || "ACTIVE";
  return <div className="lifecycle-row-wrap">
    <div className="lifecycle-row">
      <span className={`alert-rail ${alert.risk_level}`}><CircleAlert size={13} /></span>
      <div className="alert-main">
        <strong>{alert.affected_settlement_name}</strong>
        <span>Source: {alert.source_node_name} · ETA <b>{alert.eta_minutes} min</b> · <b className={`risk-text ${alert.risk_level}`}>{alert.risk_level}</b></span>
        <small><Users size={13} /> {Number(alert.population_at_risk || 0).toLocaleString()} people <MapPin size={13} /> {alert.evacuation_zone || "No evacuation point set"}</small>
        <small>Created {formatNpt(alert.created_at)} · {alert.resolved_at ? `Resolved ${formatNpt(alert.resolved_at)}${alert.resolved_by ? ` by ${alert.resolved_by}` : ""}` : "Open"}</small>
        {alert.acknowledgment_note && <small>Note: {alert.acknowledgment_note}</small>}
      </div>
      <div className="alert-side">
        <span className={`status-pill ${status}`}><i /> {status}</span>
        {canOperate && status === "ACTIVE" && <button className="demo-button small" onClick={() => onAction("acknowledge", alert)}>Acknowledge</button>}
        {canOperate && status === "ACKNOWLEDGED" && <button className="demo-button small" onClick={() => onAction("resolve", alert)}>Resolve</button>}
      </div>
      <button className="row-menu" aria-expanded={open} aria-label={open ? "Hide history" : "Show history"} onClick={() => setOpen(!open)}><Clock3 size={14} /><ChevronDown size={14} className={open ? "flip" : ""} /></button>
    </div>
    {open && <div className="history-panel"><History alertId={alert.alert_id} /></div>}
  </div>;
}

function NotificationLog({ session, onSignIn }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (session?.role !== "operator") return;
    fetchNotifications().then(setRows).catch((failure) => setError(failure.message));
  }, [session]);
  if (session?.role !== "operator") return <Banner icon={LogIn} action={<button className="demo-button small" onClick={onSignIn}>Sign in</button>}>The delivery log is visible to operators only.</Banner>;
  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return <Loading label="Loading delivery log…" />;
  if (!rows.length) return <EmptyState>No messages sent yet. They appear here when an alert is routed.</EmptyState>;
  return <div className="table-scroll"><table className="audit-table"><thead><tr><th>Time (NPT)</th><th>Channel</th><th>Recipient</th><th>Status</th><th>Message</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.id}><td>{formatNpt(row.created_at)}</td><td>{row.channel.toUpperCase()} · {row.provider}</td><td>{row.recipient}</td><td><span className={`status-pill ${row.status}`}><i /> {row.status}</span>{row.error && <small className="block">{row.error}</small>}</td><td className="wrap">{row.content.split("\n\n").map((part, i) => i === 0 ? <strong key={i} className="mail-subject">{part}</strong> : <span key={i} className="block">{part}</span>)}</td></tr>)}
  </tbody></table></div>;
}

export default function AlertsPage({ alerts, loaded, session, onSignIn }) {
  const [tab, setTab] = useState("active");
  const [pending, setPending] = useState(null);
  const canOperate = session?.role === "operator";
  const open = alerts.filter((alert) => OPEN_STATUSES.includes(alert.status));
  const groups = useMemo(() => ({
    active: alerts.filter((alert) => alert.status === "ACTIVE"),
    acknowledged: alerts.filter((alert) => alert.status === "ACKNOWLEDGED"),
    resolved: alerts.filter((alert) => alert.status === "RESOLVED"),
    all: alerts,
  }), [alerts]);
  const closeModal = useCallback(() => setPending(null), []);
  const shown = groups[tab] || [];

  return <div className="page alerts-page">
    <h2>Alerts</h2>
    <p className="page-subtitle">Acknowledge first, then track every route through resolution. Alerts also resolve automatically when the source station returns to normal.</p>
    {!canOperate && tab !== "log" && open.length > 0 && <Banner icon={LogIn} action={<button className="demo-button small" onClick={onSignIn}>Sign in</button>}>Sign in as an operator to acknowledge or resolve alerts.</Banner>}
    <Tabs label="Alert views" value={tab} onChange={setTab} tabs={[["active", "Active", groups.active.length], ["acknowledged", "Acknowledged", groups.acknowledged.length], ["resolved", "Resolved", groups.resolved.length], ["all", "All", groups.all.length], ["log", "Notification log"]]} />
    <div className="lifecycle panel-flat">
      {tab === "log" ? <NotificationLog session={session} onSignIn={onSignIn} />
        : !loaded ? <Loading label="Loading alerts…" />
        : shown.length ? shown.map((alert) => <AlertRow key={alert.alert_id} alert={alert} canOperate={canOperate} onAction={(action, target) => setPending({ action, alert: target })} />)
        : <EmptyState icon={CheckCircle2}>{tab === "all" ? "No alerts have been raised yet." : `No ${tab} alerts.`}</EmptyState>}
    </div>
    {pending && <NoteModal action={pending.action} alert={pending.alert} onClose={closeModal} onDone={closeModal} />}
  </div>;
}
