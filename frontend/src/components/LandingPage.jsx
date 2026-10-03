import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Radio, ShieldCheck, Waves } from "lucide-react";
import Logo from "./Logo";
import { fetchHealth } from "../services/api";

const fallbackStations = [
  ["Langtang", "NODE_LANGTANG_01"],
  ["Bhotekoshi", "NODE_BHOTKOSHI_02"],
  ["Syaprubesi", "NODE_SYAPRUBESI_03"],
  ["Mailung", "NODE_MAILUNG_04"],
  ["Betrawati", "NODE_BETRAWATI_05"],
  ["Trishuli", "NODE_TRISHULI_06"]
];

const pipeline = [
  ["01", "Sensors", "Water, rain and soil signals arrive every five seconds."],
  ["02", "MQTT", "A resilient message stream carries each reading downstream."],
  ["03", "Analysis", "EMA baselines and HSI make the risk decision explainable."],
  ["04", "Routing", "Dijkstra ETA routing follows the basin graph."],
  ["05", "Alerts", "Settlements receive ordered, actionable warnings."]
];

function Reveal({ children, className = "" }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    const element = document.querySelector(`[data-reveal="${CSS.escape(className)}"]`);
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [className]);
  return <div data-reveal={className} className={`landing-reveal ${visible ? "is-visible" : ""} ${className}`}>{children}</div>;
}

function CountUp({ value, suffix = "" }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / 900, 1);
      setCount(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{count}{suffix}</>;
}

function ContourField() {
  return <svg className="landing-contours" viewBox="0 0 900 700" aria-hidden="true">
    <g className="contour-lines" fill="none">
      <path d="M35 128C184 12 306 104 436 66S706 8 884 104" />
      <path d="M-12 204C142 74 302 172 436 122S707 70 916 160" />
      <path d="M-32 294C114 152 292 246 444 196S712 150 936 236" />
      <path d="M-18 380C128 252 276 340 430 286S712 226 910 318" />
      <path d="M-40 480C108 342 292 438 446 370S712 318 930 414" />
      <path d="M-16 590C134 452 292 542 454 464S716 424 936 520" />
      <path d="M-10 680C142 554 318 642 478 552S722 530 920 624" />
    </g>
    <path className="contour-river" d="M800 0C690 104 742 184 624 255S462 352 494 442s-116 148-282 258" />
    <circle className="contour-node" cx="494" cy="442" r="7" />
  </svg>;
}

export default function LandingPage({ nodes = [], settlements = [], live = {}, onNavigate }) {
  const [health, setHealth] = useState({ status: "checking", message: "Connecting to the basin network" });
  const [wave, setWave] = useState(false);
  const stationList = useMemo(() => (nodes.length ? nodes.map((node) => [node.name.split(" ")[0], node.node_id]) : fallbackStations), [nodes]);
  const hasRisk = nodes.some((node) => ["WATCH", "WARNING", "CRITICAL"].includes(live[node.node_id]?.risk_level || node.latest_reading?.risk_level || node.current_risk));
  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then(() => !cancelled && setHealth({ status: hasRisk ? "degraded" : "online", message: `${stationList.length} stations reporting · ${hasRisk ? "attention required" : "all normal"}` }))
      .catch(() => !cancelled && setHealth({ status: "offline", message: "Live network unavailable · preview mode" }));
    return () => { cancelled = true; };
  }, [stationList.length, hasRisk]);
  const navigate = (path) => onNavigate(path);
  return <div className="landing-page">
    <header className="landing-nav">
      <a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><Logo variant="full" /></a>
      <nav className="landing-links" aria-label="Landing page">
        <a href="#how-it-works">How it works</a><a href="#network">Live network</a><a href="#safety">Safety</a>
      </nav>
      <div className="landing-actions"><a className="landing-bulletin" href="/bulletin" onClick={(event) => { event.preventDefault(); navigate("/bulletin"); }}>Public bulletin</a><button className="landing-primary" onClick={() => navigate("/app/monitor")}>Open dashboard <ArrowRight size={15} /></button></div>
    </header>

    <main>
      <section className="landing-hero">
        <ContourField />
        <div className="landing-hero-copy">
          <div className={`live-chip ${health.status}`}><span /> {health.message}</div>
          <p className="eyebrow">TRISHULI · BHOTEKOSHI BASIN</p>
          <h1>See the signal<br /><em>before the flood.</em></h1>
          <p className="landing-lede">An early warning network for the rivers, slopes and settlements of the Trishuli and Bhotekoshi basin.</p>
          <div className="landing-hero-ctas"><button className="landing-primary large" onClick={() => navigate("/app/monitor")}>Open dashboard <ArrowRight size={17} /></button><button className="landing-secondary" onClick={() => navigate("/bulletin")}>View public bulletin <ArrowDownRight size={17} /></button></div>
          <div className="landing-trust"><Radio size={15} /><span>Live telemetry · explainable risk · local response</span></div>
        </div>
        <div className="hero-signal"><div className="signal-orbit orbit-one" /><div className="signal-orbit orbit-two" /><div className="signal-core"><Waves size={32} /><span>EARLY<br />WARNING</span></div></div>
      </section>

      <Reveal className="landing-section intro-strip"><p>Built for the seconds between a changing river and a community that needs to know.</p><span>Operational clarity, from sensor to settlement.</span></Reveal>

      <Reveal className="landing-section"><div id="how-it-works" className="section-anchor" /><div className="section-heading"><p className="eyebrow">01 · THE SIGNAL PATH</p><h2>From a reading<br />to a response.</h2><p>Every warning follows a visible chain. No black boxes. No disconnected dashboards.</p></div><div className="pipeline">{pipeline.map(([number, title, description], index) => <div className="pipeline-step" key={title} style={{ "--step": index }}><div className="pipeline-number">{number}</div><div className="pipeline-icon"><span /></div><h3>{title}</h3><p>{description}</p>{index < pipeline.length - 1 && <ArrowRight className="pipeline-arrow" size={18} />}</div>)}</div></Reveal>

      <Reveal className="landing-section network-section"><div id="network" className="section-anchor" /><div className="section-heading split"><div><p className="eyebrow">02 · LIVE NETWORK</p><h2>One basin.<br /><em>Six listening points.</em></h2></div><p>Station readings update continuously. The preview below is visual only; the operations dashboard remains the source of truth.</p></div><div className="network-preview"><div className="network-river" /><div className="network-stations">{stationList.map(([label, id], index) => { const reading = live[id]?.water_level_cm ?? nodes.find((node) => node.node_id === id)?.latest_reading?.water_level_cm ?? ["46.1", "66.4", "85.1", "96.3", "65.9", "96.7"][index]; return <div className={`network-station ${wave ? "wave-active" : ""}`} style={{ "--station-index": index }} key={id}><span className="station-pulse" /><strong>{label}</strong><code>{Number(reading).toFixed(1)} cm</code></div>; })}</div><button className={`wave-button ${wave ? "playing" : ""}`} onClick={() => { setWave(true); window.setTimeout(() => setWave(false), 3400); }} disabled={wave}>{wave ? "Flood wave moving downstream" : "Play flood-wave preview"} <ArrowRight size={15} /></button></div></Reveal>

      <Reveal className="landing-section numbers-section"><div className="number-item"><strong><CountUp value={stationList.length} /></strong><span>stations listening</span></div><div className="number-item"><strong><CountUp value={5} suffix="s" /></strong><span>update interval</span></div><div className="number-item"><strong><CountUp value={settlements.length || 4} /></strong><span>settlements covered</span></div><div className="number-item"><strong><CountUp value={4} /></strong><span>alert lifecycle steps</span></div></Reveal>

      <Reveal className="landing-section feature-section"><div className="section-heading"><p className="eyebrow">03 · THE OPERATING MODEL</p><h2>Decisions with<br /><em>a visible reason.</em></h2></div><div className="feature-list">{[["Explainable risk score", "HSI combines level, rate and soil signals into a clear threshold decision.", "01"], ["ETA routing", "Graph-based routing orders downstream settlements by arrival time.", "02"], ["Alert lifecycle", "Active, acknowledged and resolved states keep every warning accountable.", "03"], ["Operator audit trail", "Every configuration and state change has a durable history.", "04"], ["Public bulletin", "A calm, plain-language view for people who need the next step.", "05"], ["Live stream", "WebSocket telemetry keeps the network current without refreshes.", "06"]].map(([title, copy, number]) => <div className="feature-row" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p><ArrowUpRight size={17} /></div>)}</div></Reveal>

      <Reveal className="landing-section safety-section"><div id="safety" className="section-anchor" /><div className="safety-mark"><ShieldCheck size={28} /></div><div><p className="eyebrow">04 · WHEN A WARNING ARRIVES</p><h2>Know the next<br /><em>safe step.</em></h2><p>Move to higher ground when instructed. Take medicines, documents and water. Follow local responders and use the public bulletin for current settlement guidance.</p><button className="landing-secondary" onClick={() => navigate("/bulletin")}>Open safety bulletin <ArrowRight size={15} /></button></div></Reveal>
    </main>
    <footer className="landing-footer"><Logo variant="full" /><span>Trishuli Flood & Landslide Early Warning System</span><button onClick={() => navigate("/app/monitor")}>Operations dashboard <ArrowRight size={14} /></button></footer>
  </div>;
}
