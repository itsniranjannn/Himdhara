import React, { useState } from "react";
import { CircleAlert, Clock3, Download } from "lucide-react";
import { EmptyState, Loading } from "../components/ui";
import { formatDuration, formatNpt } from "../lib/format";
import { exportIncidents } from "../services/api";

export default function IncidentsPage({ incidents, loaded, nodes, session, onSignIn, now }) {
  const [error, setError] = useState("");
  const names = Object.fromEntries(nodes.map((node) => [node.node_id, node.name]));
  async function exportCsv() {
    setError("");
    if (!session) return onSignIn();
    try { await exportIncidents(); } catch (failure) { setError(failure.message); }
  }
  return <div className="page alerts-page">
    <div className="page-heading-row">
      <div><h2>Incidents</h2><p className="page-subtitle">Warning and critical periods recorded by the risk engine, from start to recovery.</p></div>
      <button className="demo-submit with-icon" onClick={exportCsv} title={session ? "Download all incidents as CSV" : "Sign in to export"}><Download size={15} /> Export CSV</button>
    </div>
    {error && <p className="form-error">{error}</p>}
    <div className="lifecycle panel-flat">
      {!loaded ? <Loading label="Loading incidents…" />
        : incidents.length ? incidents.map((incident) => {
          const shortId = incident.incident_id?.split("-").slice(-2).join("-") || incident.incident_id;
          return <div className="lifecycle-row" key={incident.incident_id}>
            <span className={`alert-rail ${incident.peak_risk}`}><CircleAlert size={13} /></span>
            <div className="alert-main">
              <strong title={incident.incident_id}>{names[incident.source_node_id] || incident.source_node_id} <small className="inline">#{shortId}</small></strong>
              <span>Peak <b className={`risk-text ${incident.peak_risk}`}>{incident.peak_risk}</b> · Duration <b>{formatDuration(incident.started_at, incident.recovered_at, now)}</b></span>
              <small><Clock3 size={13} /> Started {formatNpt(incident.started_at)} · {incident.recovered_at ? `Recovered ${formatNpt(incident.recovered_at)}` : "Still active"}</small>
              {incident.recovery_note && <small>{incident.recovery_note}</small>}
            </div>
            <span className={`status-pill ${incident.recovered_at ? "RESOLVED" : "ACTIVE"}`}><i /> {incident.recovered_at ? "RECOVERED" : "ACTIVE"}</span>
          </div>;
        })
        : <EmptyState>No incidents recorded yet. Use Demo → Send flood spike to create one.</EmptyState>}
    </div>
  </div>;
}
