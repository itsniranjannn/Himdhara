import React, { useState } from "react";
import { Phone, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import Logo from "../components/Logo";
import { ThemeToggle } from "../components/Shell";
import { RiskLabel } from "../components/ui";
import { LANGUAGES, messages } from "../lib/i18n";
import { RISK_RANK, riskOf } from "../lib/format";
import { subscribePublic } from "../services/api";

function Subscribe({ t, settlements, lang }) {
  const [state, setState] = useState({ status: "idle", text: "" });
  async function submit(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setState({ status: "busy", text: "" });
    try {
      await subscribePublic(form.get("settlement"), form.get("email"), form.get("language"));
      setState({ status: "ok", text: t.subscribed });
      element.reset();
    } catch (failure) {
      setState({ status: "error", text: failure.message });
    }
  }
  if (!settlements.length) return null;
  return <section className="panel subscribe-panel">
    <div className="panel-title-row"><h2>{t.subscribeTitle}</h2></div>
    <p className="muted">{t.subscribeBody}</p>
    <form className="subscribe-form" onSubmit={submit}>
      <label className="field"><span>{t.settlement}</span><select name="settlement" required>{settlements.map((item) => <option key={item.settlement_id} value={item.settlement_id}>{item.name}</option>)}</select></label>
      <label className="field"><span>{t.email}</span><input name="email" type="email" required placeholder={t.emailHint} autoComplete="email" /></label>
      <label className="field"><span>{t.languageLabel}</span><select name="language" key={lang} defaultValue={lang}>{Object.entries(LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <button className="demo-submit" disabled={state.status === "busy"}>{state.status === "busy" ? t.subscribing : t.subscribe}</button>
    </form>
    {state.text && <p className={state.status === "ok" ? "demo-message" : "form-error"} role="status">{state.text}</p>}
  </section>;
}

export default function BulletinPage({ basins, basin, onBasinChange, nodes, openAlerts, settlements, live, now, staleSeconds, apiDown, loaded, weather, theme, onToggleTheme, navigate }) {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("himdhara-lang") || "en"; } catch { return "en"; } });
  const t = messages[lang];
  const choose = (code) => { setLang(code); try { localStorage.setItem("himdhara-lang", code); } catch { /* storage unavailable */ } };
  const sortedAlerts = [...openAlerts].sort((a, b) => a.eta_minutes - b.eta_minutes);
  const status = apiDown ? "offline" : sortedAlerts.length ? "active" : "clear";
  const StatusIcon = status === "offline" ? WifiOff : status === "active" ? ShieldAlert : ShieldCheck;
  const alertedSettlements = new Set(sortedAlerts.map((alert) => alert.affected_settlement_id));

  return <main className="public-standalone" lang={lang}>
    <header className="public-header">
      <a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} aria-label="Trishuli home"><Logo variant="full" /></a>
      <div>
        {basins.length > 0 && <select className="public-basin" aria-label={t.basinLabel} value={basin?.basin_id || ""} onChange={(event) => onBasinChange(event.target.value)}>{basins.map((item) => <option key={item.basin_id} value={item.basin_id}>{lang === "ne" ? item.name_ne || item.name : item.name}</option>)}</select>}
        <div className="lang-switch" role="group" aria-label="Language">{Object.entries(LANGUAGES).map(([code, label]) => <button key={code} className={lang === code ? "on" : ""} aria-pressed={lang === code} onClick={() => choose(code)}>{label}</button>)}</div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <a className="public-dashboard-link" href="/app/monitor" onClick={(event) => { event.preventDefault(); navigate("/app/monitor"); }}>{t.operations}</a>
      </div>
    </header>
    <div className="public-shell">
      <section className="public-hero">
        <div><p className="eyebrow">{t.eyebrow}{basin ? ` · ${(lang === "ne" ? basin.name_ne : basin.name).toUpperCase()}` : ""}</p><h1>{t.title}</h1><p>{t.intro(basin ? (lang === "ne" ? basin.name_ne : basin.name) : "")}</p>{basin?.simulated && <span className="demo-data-note">{t.simulatedNote}</span>}</div>
        <div className={`public-status ${status}`} role="status"><StatusIcon size={22} /><strong>{status === "offline" ? t.offline : status === "active" ? t.active : t.clear}</strong><span>{status === "offline" ? t.offlineBody : status === "active" ? t.activeBody : t.clearBody}</span></div>
      </section>

      {sortedAlerts.length > 0 && <section className="public-urgent"><h2>{t.guidance}</h2>
        {sortedAlerts.map((alert) => <div className={`public-alert ${alert.risk_level}`} key={alert.alert_id}><strong>{alert.affected_settlement_name}</strong><span>{t.moveTo(alert.evacuation_zone)}</span><small>{t.eta(Math.round(alert.eta_minutes))}</small></div>)}
      </section>}

      <section className="guidance two-col"><div><h2>{t.before}</h2><ul>{t.beforeItems.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h2>{t.during}</h2><ul>{t.duringItems.map((item) => <li key={item}>{item}</li>)}</ul></div></section>

      <div className="public-grid">
        <section className="panel public-stations"><div className="panel-title-row"><h2>{t.stations}</h2><span>{t.updatedLive}</span></div>
          {!loaded ? <p className="muted">…</p> : [...nodes].sort((a, b) => RISK_RANK[riskOf(b, live, now, staleSeconds)] - RISK_RANK[riskOf(a, live, now, staleSeconds)]).map((node) => {
            const risk = riskOf(node, live, now, staleSeconds);
            return <div className="public-row" key={node.node_id}><div><strong>{node.name}</strong><small>{t.risk[risk]}</small></div><RiskLabel risk={risk} label={t.riskTag[risk]} /></div>;
          })}
        </section>
        <section className="panel public-guidance"><div className="panel-title-row"><h2>{t.evacuationPoints}</h2><span>{t.routes(sortedAlerts.length)}</span></div>
          {settlements.length ? settlements.map((settlement) => <div className={`public-row ${alertedSettlements.has(settlement.settlement_id) ? "alerted" : ""}`} key={settlement.settlement_id}><div><strong>{settlement.name}</strong><small>{settlement.evacuation_zone || "—"} · {t.num(Number(settlement.population || 0).toLocaleString())} {t.people}</small></div>{alertedSettlements.has(settlement.settlement_id) && <span className="risk-label CRITICAL" role="img" aria-label={t.riskTag.CRITICAL}><i /></span>}</div>) : <p className="muted">{t.noAlerts}</p>}
        </section>
      </div>

      <section className="panel public-outlook">
        <div className="panel-title-row"><h2>{t.rainTitle}</h2>{weather?.level && <span className={`rain-badge ${weather.level}`}>{t.rainLevels[weather.level]}</span>}</div>
        {weather?.status === "OK" || weather?.status === "STALE"
          ? <p>{t.rainBody(Math.round(Math.max(...weather.stations.map((station) => station.next_24h_mm), 0)))} <small className="muted"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">{t.rainCredit}</a></small></p>
          : <p className="muted">{t.rainUnavailable}</p>}
      </section>

      <Subscribe key={basin?.basin_id} t={t} settlements={settlements} lang={lang} />

      <section className="emergency"><h2><Phone size={16} /> {t.emergency}</h2><div>{t.emergencyItems.map(([label, number]) => <a key={label} href={`tel:${number}`}><b>{t.num(number)}</b><span>{label}</span></a>)}</div></section>
      <p className="disclaimer">{t.disclaimer}</p>
    </div>
  </main>;
}
