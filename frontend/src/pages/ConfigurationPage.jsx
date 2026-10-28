import React, { useCallback, useEffect, useState } from "react";
import { LogIn, Trash2 } from "lucide-react";
import { Banner, EmptyState, Field, Loading } from "../components/ui";
import { addContact, deleteContact, fetchContacts, updateSettlement, updateThresholds } from "../services/api";

function ThresholdForm({ node, canEdit, onSaved }) {
  const t = node?.thresholds || {};
  const [values, setValues] = useState({ watch: t.water_level_watch ?? 100, warning: t.water_level_warning ?? 150, critical: t.water_level_critical ?? 200 });
  const [message, setMessage] = useState(null);
  const ordered = Number(values.watch) < Number(values.warning) && Number(values.warning) < Number(values.critical);
  async function save(event) {
    event.preventDefault();
    setMessage(null);
    try {
      const saved = await updateThresholds(node.node_id, { water_level_watch: Number(values.watch), water_level_warning: Number(values.warning), water_level_critical: Number(values.critical) });
      onSaved(node.node_id, saved.thresholds);
      setMessage({ ok: true, text: "Thresholds saved and applied to the live engine." });
    } catch (failure) { setMessage({ ok: false, text: failure.message }); }
  }
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  return <form onSubmit={save} className="stack">
    {[["watch", "Watch (cm)"], ["warning", "Warning (cm)"], ["critical", "Critical (cm)"]].map(([key, label]) => <Field key={key} label={label}><input disabled={!canEdit} type="number" min="1" step="any" value={values[key]} onChange={set(key)} required /></Field>)}
    {!ordered && <p className="form-error">Thresholds must increase: watch &lt; warning &lt; critical.</p>}
    {message && <p className={message.ok ? "demo-message" : "form-error"}>{message.text}</p>}
    <button className="demo-submit" disabled={!canEdit || !ordered}>Save thresholds</button>
  </form>;
}

function SettlementForm({ settlement, canEdit, onSaved }) {
  const [message, setMessage] = useState(null);
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    try {
      onSaved(await updateSettlement(settlement.settlement_id, { name: form.get("name"), evacuation_zone: form.get("evacuation_zone"), population: Number(form.get("population")) }));
      setMessage({ ok: true, text: "Saved." });
    } catch (failure) { setMessage({ ok: false, text: failure.message }); }
  }
  return <form className="settlement-edit" onSubmit={save}>
    <Field label="Name"><input disabled={!canEdit} name="name" defaultValue={settlement.name} required /></Field>
    <Field label="Evacuation point"><input disabled={!canEdit} name="evacuation_zone" defaultValue={settlement.evacuation_zone || ""} /></Field>
    <Field label="Population"><input disabled={!canEdit} name="population" type="number" min="0" defaultValue={settlement.population || 0} /></Field>
    <button disabled={!canEdit} className="row-menu">Save</button>
    {message && <p className={`${message.ok ? "demo-message" : "form-error"} span-all`}>{message.text}</p>}
  </form>;
}

function Contacts({ settlements, canEdit, health }) {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchContacts().then(setContacts).catch((failure) => setError(failure.message)), []);
  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);
  const names = Object.fromEntries(settlements.map((item) => [item.settlement_id, item.name]));
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await addContact({ settlement_id: data.get("settlement_id"), name: data.get("name"), phone: data.get("phone") || null, email: data.get("email") || null, language: data.get("language") });
      form.reset();
      await load();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    try { await deleteContact(id); await load(); } catch (failure) { setError(failure.message); }
  }
  if (!canEdit) return <p className="muted">Alert contacts are visible to operators only.</p>;
  return <>
    <p className="muted small">Delivery: SMS via <b>{health?.sms_provider || "—"}</b>, email via <b>{health?.email_provider || "—"}</b>. {health?.sms_provider === "simulated" && "Simulated means messages are logged but not actually sent; set SMS_PROVIDER=sparrow in .env to send real SMS."}</p>
    <form className="contact-form" onSubmit={add}>
      <Field label="Settlement"><select name="settlement_id" required>{settlements.map((item) => <option key={item.settlement_id} value={item.settlement_id}>{item.name}</option>)}</select></Field>
      <Field label="Name"><input name="name" required maxLength={100} placeholder="Ward office" /></Field>
      <Field label="Mobile"><input name="phone" inputMode="tel" placeholder="98XXXXXXXX" /></Field>
      <Field label="Email"><input name="email" type="email" placeholder="optional" /></Field>
      <Field label="Language"><select name="language"><option value="en">English</option><option value="ne">नेपाली</option></select></Field>
      <button className="demo-submit" disabled={busy}>Add contact</button>
    </form>
    {error && <p className="form-error">{error}</p>}
    {contacts === null ? <Loading /> : contacts.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Settlement</th><th>Name</th><th>Mobile</th><th>Email</th><th>Lang</th><th>Source</th><th /></tr></thead><tbody>
      {contacts.map((contact) => <tr key={contact.id}><td>{names[contact.settlement_id] || contact.settlement_id}</td><td>{contact.name}</td><td>{contact.phone || "—"}</td><td>{contact.email || "—"}</td><td>{contact.language}</td><td>{contact.source}</td><td><button className="row-menu" aria-label={`Remove ${contact.name}`} onClick={() => remove(contact.id)}><Trash2 size={14} /></button></td></tr>)}
    </tbody></table></div> : <EmptyState>No contacts yet. Residents can also register from the public bulletin.</EmptyState>}
  </>;
}

export default function ConfigurationPage({ nodes, settlements, setSettlements, onThresholdsSaved, session, onSignIn, health }) {
  const [selected, setSelected] = useState(nodes[0]?.node_id || "");
  const canEdit = session?.role === "operator";
  const node = nodes.find((item) => item.node_id === selected) || nodes[0];
  return <div className="page alerts-page">
    <h2>Configuration</h2>
    <p className="page-subtitle">Station thresholds, settlement routing details and who receives alerts.</p>
    {!canEdit && <Banner tone="warn" icon={LogIn} action={<button className="demo-button small" onClick={onSignIn}>Sign in</button>}>Read-only. Sign in as an operator to edit.</Banner>}
    <div className="config-grid">
      <section className="panel config-form"><div className="panel-title-row"><h3>Station thresholds</h3><span>Applied live</span></div>
        <Field label="Station"><select value={node?.node_id || ""} onChange={(event) => setSelected(event.target.value)}>{nodes.map((item) => <option key={item.node_id} value={item.node_id}>{item.name}</option>)}</select></Field>
        {node && <ThresholdForm key={node.node_id + JSON.stringify(node.thresholds)} node={node} canEdit={canEdit} onSaved={onThresholdsSaved} />}
      </section>
      <section className="panel config-form"><div className="panel-title-row"><h3>Settlements</h3><span>{settlements.length}</span></div>
        {settlements.length ? settlements.map((settlement) => <SettlementForm key={settlement.settlement_id + settlement.updated_at} settlement={settlement} canEdit={canEdit} onSaved={(updated) => setSettlements((current) => current.map((item) => item.settlement_id === updated.settlement_id ? updated : item))} />) : <EmptyState>No settlements loaded.</EmptyState>}
      </section>
    </div>
    <section className="panel config-form wide"><div className="panel-title-row"><h3>Alert contacts</h3><span>SMS and email recipients</span></div>
      <Contacts settlements={settlements} canEdit={canEdit} health={health} />
    </section>
  </div>;
}
