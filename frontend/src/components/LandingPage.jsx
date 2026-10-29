import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight, CloudRain, GitBranch, MapPin, Mountain, Play, Radio, ScanLine, ShieldCheck, Waves, Workflow } from "lucide-react";
import Logo from "./Logo";
import Modal from "./Modal";
import { credits } from "../config/credits";
import { brand } from "../config/brand";

const steps = [
  { n: "01", title: "Sensors", icon: CloudRain, short: "Water level, rain and soil moisture every five seconds.",
    long: "Each gauge station reports water level, rainfall and soil moisture. Readings are validated at the door: out-of-range values and malformed payloads are rejected before they can touch a risk score.",
    points: ["Level in centimetres, rain in millimetres, soil as a percentage", "Stations that go quiet are flagged OFFLINE, never shown as safe", "Simulated publishers stand in until field hardware is installed"] },
  { n: "02", title: "MQTT", icon: Radio, short: "A resilient message stream carries each reading downstream.",
    long: "Readings travel over MQTT, the lightweight protocol built for weak links. A private topic prefix keeps the stream separate from other users of the public broker.",
    points: ["Publish and subscribe, no polling", "Survives dropped connections and reconnects on its own", "The browser gets the same stream over a WebSocket"] },
  { n: "03", title: "Analysis", icon: ScanLine, short: "EMA baselines and the HSI score make every decision explainable.",
    long: "An exponential moving average smooths noise, the rate of change shows how fast the river is rising, and the Hazard Severity Index blends level, rate and soil saturation into one score.",
    points: ["HSI = level + 0.5 x rate + soil", "Bands: Normal, Watch, Warning, Critical", "Every decision stores the reason it was made"] },
  { n: "04", title: "Routing", icon: GitBranch, short: "Dijkstra ETA routing follows the basin graph downstream.",
    long: "Each basin is a graph of stations and settlements with measured travel times. When a station escalates, shortest-path routing tells every downstream settlement how long until the wave reaches it.",
    points: ["Warnings never cross into another basin", "Settlements are ordered by arrival time", "Evacuation points are attached to each community"] },
  { n: "05", title: "Alerts", icon: Workflow, short: "Settlements get ordered, actionable warnings in their language.",
    long: "Operators acknowledge and resolve alerts while subscribers receive Telegram, email or SMS messages in English or Nepali. Every delivery attempt is logged.",
    points: ["Active, acknowledged, resolved: nothing is lost", "Free channels first: Telegram and email", "A public bulletin for anyone, no login"] }
];

const features = [
  ["Explainable risk", "HSI combines level, rate and soil into a threshold decision you can audit.", Mountain],
  ["ETA routing", "Graph routing orders downstream settlements by arrival time.", GitBranch],
  ["Alert lifecycle", "Active, acknowledged and resolved states keep every warning accountable.", ShieldCheck],
  ["Rain outlook", "Free Open-Meteo forecasts add the next 72 hours of rain to each basin.", CloudRain],
  ["Public bulletin", "A calm, bilingual, plain-language page for people who need the next step.", MapPin],
  ["Live stream", "WebSocket telemetry keeps every screen current without refreshes.", Waves]
];

// Stylised Nepal outline (lng, lat). Not survey-grade: it frames the real station positions.
const NEPAL = [[80.06, 28.83], [80.3, 29.7], [80.2, 30.42], [80.9, 30.25], [81.4, 30.1], [82.1, 30.35], [82.9, 29.9], [83.6, 29.3], [84.2, 29.25], [84.7, 28.7], [85.2, 28.3], [85.9, 28.2], [86.5, 28.1], [87.0, 27.9], [88.2, 27.85], [88.1, 26.4], [87.3, 26.4], [86.2, 26.55], [85.2, 26.75], [84.3, 27.2], [83.5, 27.4], [82.7, 27.7], [82.0, 28.0], [81.4, 28.4], [80.6, 28.65]];
const MAP = { w: 80.0, e: 88.3, s: 26.2, n: 30.6, width: 1000, height: 560 };
const toMap = (lng, lat) => [(lng - MAP.w) / (MAP.e - MAP.w) * MAP.width, (MAP.n - lat) / (MAP.n - MAP.s) * MAP.height];

function smooth(points) {
  if (points.length < 2) return "";
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// Fit a basin's real coordinates into a view box without distorting distances.
function basinFrame(nodes, settlements, width = 760, height = 440) {
  const all = [...nodes, ...settlements].filter((p) => p.lat && p.lng);
  if (!all.length) return { project: () => [width / 2, height / 2] };
  const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos(midLat * Math.PI / 180);
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * k, 0.02);
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 0.02);
  const pad = 70;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2, offY = (height - spanY * scale) / 2;
  return { project: (lng, lat) => [offX + (lng - Math.min(...lngs)) * k * scale, offY + (Math.max(...lats) - lat) * scale] };
}

function Reveal({ children, className = "", delay = 0, as = "div" }) {
  const ref = useRef(null);
  const visible = useInView(ref, { once: true, amount: 0.15 });
  const reduced = useReducedMotion();
  const Tag = motion[as];
  return <Tag ref={ref} className={className} initial={reduced ? false : { opacity: 0, y: 34, filter: "blur(6px)" }}
    animate={visible || reduced ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
    transition={{ duration: .8, delay, ease: [0.16, 1, 0.3, 1] }}>{children}</Tag>;
}

function CountUp({ value, suffix = "" }) {
  const ref = useRef(null);
  const visible = useInView(ref, { once: true, amount: .6 });
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / 1400, 1);
      setCount(Math.round(value * (1 - Math.pow(1 - p, 4))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, value]);
  return <span ref={ref}>{count}{suffix}</span>;
}

// Cursor-following glow, used on cards.
function Spotlight({ children, className = "", ...rest }) {
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
  };
  return <div className={`spot ${className}`} onPointerMove={onMove} {...rest}>{children}</div>;
}

function Ridges({ scrollY }) {
  const back = useTransform(scrollY, [0, 700], [0, -70]);
  const mid = useTransform(scrollY, [0, 700], [0, -130]);
  const front = useTransform(scrollY, [0, 700], [0, -210]);
  return <div className="ridges" aria-hidden="true">
    <motion.svg style={{ y: back }} viewBox="0 0 1440 320" preserveAspectRatio="none" className="ridge r1"><path d="M0 220 L120 140 L210 190 L330 80 L430 170 L560 110 L690 200 L800 90 L930 180 L1060 70 L1180 160 L1300 110 L1440 190 V320 H0Z" /></motion.svg>
    <motion.svg style={{ y: mid }} viewBox="0 0 1440 320" preserveAspectRatio="none" className="ridge r2"><path d="M0 250 L90 200 L200 240 L320 160 L450 230 L580 170 L700 240 L840 150 L960 230 L1090 180 L1220 240 L1340 190 L1440 230 V320 H0Z" /></motion.svg>
    <motion.svg style={{ y: front }} viewBox="0 0 1440 320" preserveAspectRatio="none" className="ridge r3"><path d="M0 290 L140 255 L260 285 L400 240 L540 285 L700 250 L860 290 L1010 245 L1160 285 L1300 255 L1440 285 V320 H0Z" /></motion.svg>
  </div>;
}

function NepalMap({ basins, nodes, activeId, onPick }) {
  const groups = useMemo(() => basins.map((basin) => {
    const own = nodes.filter((n) => n.basin_id === basin.basin_id && n.lat && n.lng);
    const pts = own.map((n) => toMap(n.lng, n.lat));
    const c = pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : null;
    return { basin, pts, c };
  }).filter((g) => g.c), [basins, nodes]);
  const outline = NEPAL.map(([lng, lat]) => toMap(lng, lat));
  // Label offsets keep the crowded Trishuli/Bagmati/Gandaki cluster readable.
  const LABELS = { trishuli: [-8, -86, "middle"], bagmati: [8, 78, "middle"], gandaki: [-70, -52, "end"], koshi: [64, 58, "start"], karnali: [-64, -46, "end"] };
  const labelFor = (id, i) => LABELS[id] || [i % 2 ? 60 : -60, i % 2 ? 50 : -50, i % 2 ? "start" : "end"];

  return <svg className="nepal-map" viewBox={`0 0 ${MAP.width} ${MAP.height}`} role="img" aria-label="Map of Nepal with the monitored river basins">
    <defs>
      <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity=".04" /></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
    <path className="nepal-land" d={`${smooth([...outline, outline[0]])}Z`} />
    {Array.from({ length: 9 }, (_, i) => { const [x] = toMap(80 + i, 28); return <line key={`m${i}`} className="graticule" x1={x} y1="0" x2={x} y2={MAP.height} />; })}
    {Array.from({ length: 5 }, (_, i) => { const [, y] = toMap(80, 27 + i); return <line key={`p${i}`} className="graticule" x1="0" y1={y} x2={MAP.width} y2={y} />; })}
    {groups.map(({ basin, pts, c }, index) => {
      const active = basin.basin_id === activeId;
      const [dx, dy, anchor] = labelFor(basin.basin_id, index);
      return <g key={basin.basin_id} className={`hotspot ${active ? "on" : ""} ${basin.open_alerts ? "alert" : ""}`} onClick={() => onPick(basin.basin_id)} tabIndex={0} role="button" aria-label={`${basin.name} basin`} aria-pressed={active}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(basin.basin_id)}>
        {pts.length > 1 && <path className="hot-river" d={smooth(pts)} />}
        <circle className="hot-ring" cx={c[0]} cy={c[1]} r="14" style={{ animationDelay: `${index * .4}s` }} />
        <circle className="hot-ring two" cx={c[0]} cy={c[1]} r="14" style={{ animationDelay: `${index * .4 + 1.1}s` }} />
        <circle className="hot-dot" cx={c[0]} cy={c[1]} r="7" filter="url(#glow)" />
        <line className="hot-leader" x1={c[0]} y1={c[1]} x2={c[0] + dx} y2={c[1] + dy + (dy < 0 ? 22 : -16)} />
        <text className="hot-label" x={c[0] + dx} y={c[1] + dy} textAnchor={anchor}>{basin.name}</text>
        <text className="hot-sub" x={c[0] + dx} y={c[1] + dy + 17} textAnchor={anchor}>{basin.stations} stations</text>
      </g>;
    })}
  </svg>;
}

function BasinExplorer({ basin, nodes, settlements, live, onOpenStation }) {
  const [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  const frame = useMemo(() => basinFrame(nodes, settlements), [nodes, settlements]);
  const pts = useMemo(() => nodes.map((n) => frame.project(n.lng, n.lat)), [nodes, frame]);
  const path = smooth(pts);
  const cumulative = useMemo(() => {
    const out = [0];
    for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = out[out.length - 1] || 1;
    return out.map((v) => v / total);
  }, [pts]);
  const duration = 6;
  const pathId = `flow-${basin?.basin_id || "x"}`;

  return <div className="explorer-stage">
    <svg viewBox="0 0 760 440" role="img" aria-label={`Stations and settlements of the ${basin?.name} basin`}>
      <defs><radialGradient id="wave-glow"><stop offset="0" stopColor="var(--accent)" stopOpacity=".95" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient></defs>
      <path id={pathId} className="ex-river-bed" d={path} />
      <path className="ex-river" d={path} />
      {settlements.map((s) => {
        const [x, y] = frame.project(s.lng, s.lat);
        return <g key={s.settlement_id} className="ex-settle"><rect x={x - 6} y={y - 6} width="12" height="12" rx="2" transform={`rotate(45 ${x} ${y})`} /><text x={x + 12} y={y + 4}>{s.name.split(" ").slice(0, 2).join(" ")}</text></g>;
      })}
      {nodes.map((n, i) => {
        const [x, y] = pts[i];
        const risk = live[n.node_id]?.risk_level ?? n.current_risk ?? "NORMAL";
        return <g key={`${n.node_id}-${run}`} className={`ex-station ${risk}`} tabIndex={0} role="button" aria-label={`${n.name}, ${risk}`} onClick={() => onOpenStation(n)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenStation(n)}>
          {run > 0 && !reduced && <circle className="ex-hit" cx={x} cy={y} r="10" style={{ animationDelay: `${cumulative[i] * duration}s` }} />}
          <circle className="ex-halo" cx={x} cy={y} r="16" />
          <circle className="ex-core" cx={x} cy={y} r="8" />
          <text className="ex-name" x={x} y={y + (i % 2 ? 32 : -22)} textAnchor="middle">{n.name.replace(/ (Gauge|Station|Sector)$/i, "").split(" ").slice(0, 3).join(" ")}</text>
        </g>;
      })}
      {run > 0 && !reduced && <g key={`wave-${run}`}><circle r="22" fill="url(#wave-glow)"><animateMotion dur={`${duration}s`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.6 1"><mpath href={`#${pathId}`} /></animateMotion></circle><circle r="6" className="ex-wave-core"><animateMotion dur={`${duration}s`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.6 1"><mpath href={`#${pathId}`} /></animateMotion></circle></g>}
    </svg>
    <div className="explorer-controls">
      <button className="btn-accent" onClick={() => setRun((v) => v + 1)}><Play size={15} /> Play flood-wave preview</button>
      <span>The glow travels at scaled speed. Click any station for its latest reading.</span>
    </div>
  </div>;
}

export default function LandingPage({ basins = [], nodes = [], settlements = [], live = {}, onNavigate, onChooseBasin, apiDown = false }) {
  const reduced = useReducedMotion();
  const { scrollYProgress, scrollY } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: .3 });
  const pipeScale = useTransform(scrollYProgress, [0.1, 0.32], [0, 1]);
  const [activeId, setActiveId] = useState("");
  const [stepOpen, setStepOpen] = useState(null);
  const [stationOpen, setStationOpen] = useState(null);
  const active = basins.find((b) => b.basin_id === activeId) || basins[0] || null;
  const activeNodes = useMemo(() => nodes.filter((n) => n.basin_id === active?.basin_id), [nodes, active]);
  const activeSettlements = useMemo(() => settlements.filter((s) => s.basin_id === active?.basin_id), [settlements, active]);
  const openAlerts = basins.reduce((sum, b) => sum + (b.open_alerts || 0), 0);
  const navigate = (path) => onNavigate(path);
  const openBasin = (id, path = "/app/monitor") => { onChooseBasin?.(id); navigate(path); };
  const health = apiDown ? { tone: "offline", text: "Live network unavailable · preview mode" }
    : !basins.length ? { tone: "checking", text: "Connecting to the basin network" }
    : { tone: openAlerts ? "alert" : "online", text: `${nodes.length} stations in ${basins.length} basins · ${openAlerts ? `${openAlerts} open alerts` : "all normal"}` };

  const ticker = useMemo(() => nodes.map((n) => {
    const r = live[n.node_id] || n.latest_reading || {};
    return { id: n.node_id, name: n.name.replace(/ (Gauge|Station|Sector)$/i, ""), level: r.water_level_cm, risk: r.risk_level || n.current_risk || "NORMAL" };
  }), [nodes, live]);

  const heroRef = useRef(null);
  const onHeroMove = (event) => {
    if (reduced || !heroRef.current) return;
    const box = heroRef.current.getBoundingClientRect();
    heroRef.current.style.setProperty("--hx", `${event.clientX - box.left}px`);
    heroRef.current.style.setProperty("--hy", `${event.clientY - box.top}px`);
  };

  const headline = ["See", "the", "signal"];

  return <div className="landing-page">
    <motion.div className="scroll-bar" style={{ scaleX: progress }} aria-hidden="true" />
    <header className="landing-nav">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}><Logo variant="full" /></a>
      <nav className="landing-links" aria-label="Landing page"><a href="#how-it-works">How it works</a><a href="#network">River basins</a><a href="#features">Features</a><a href="#safety">Safety</a></nav>
      <div className="landing-actions"><a className="landing-bulletin" href="/bulletin" onClick={(e) => { e.preventDefault(); navigate("/bulletin"); }}>Public bulletin</a><button className="landing-primary" onClick={() => navigate("/app/monitor")}>Open dashboard <ArrowRight size={15} /></button></div>
    </header>

    <main>
      <section className="landing-hero" ref={heroRef} onPointerMove={onHeroMove}>
        <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="hero-cursor" aria-hidden="true" />
        <Ridges scrollY={scrollY} />
        <div className="hero-grid">
          <div className="landing-hero-copy">
            <motion.div className={`live-chip ${health.tone}`} initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }}><span /> {health.text}</motion.div>
            <p className="eyebrow">NEPAL · {basins.length || "MANY"} RIVER BASINS · FREE &amp; OPEN DATA</p>
            <h1 aria-label="See the signal before the flood.">
              {headline.map((w, i) => <motion.span key={w} className="word" initial={reduced ? false : { y: "110%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .15 + i * .12, duration: .8, ease: [0.16, 1, 0.3, 1] }}>{w}&nbsp;</motion.span>)}
              <br />
              <motion.span className="word grad" initial={reduced ? false : { y: "110%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .55, duration: .9, ease: [0.16, 1, 0.3, 1] }}>before the flood.</motion.span>
            </h1>
            <motion.p className="landing-lede" initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .9, duration: .7 }}>{brand.description} One system watches every basin, routes warnings downstream and tells communities where to go.</motion.p>
            <motion.div className="landing-hero-ctas" initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: .7 }}>
              <button className="btn-accent large" onClick={() => navigate("/app/monitor")}>Open dashboard <ArrowRight size={17} /></button>
              <button className="landing-secondary" onClick={() => navigate("/bulletin")}>Public bulletin <ArrowUpRight size={16} /></button>
            </motion.div>
          </div>

          <motion.div className="hero-map" initial={reduced ? false : { opacity: 0, scale: .94, rotateX: 8 }} animate={{ opacity: 1, scale: 1, rotateX: 0 }} transition={{ delay: .4, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}>
            <div className="hero-map-head"><Waves size={15} /><strong>Live basin map</strong><span>real station positions · stylised border</span></div>
            <NepalMap basins={basins} nodes={nodes} activeId={active?.basin_id} onPick={setActiveId} />
            <div className="hero-map-foot">
              {active ? <><span className={`state-dot ${active.open_alerts ? "alert" : "calm"}`} /><b>{active.name}</b><small>{active.region}</small><button onClick={() => openBasin(active.basin_id)}>Open <ArrowRight size={13} /></button></> : <small>{apiDown ? "Live data unavailable" : "Connecting…"}</small>}
            </div>
          </motion.div>
        </div>
      </section>

      <div className="ticker" aria-label="Latest station readings">
        <div className="ticker-track">
          {[0, 1].map((copy) => <ul key={copy} aria-hidden={copy === 1}>{ticker.map((t) => <li key={`${copy}-${t.id}`}><i className={`tick ${t.risk}`} />{t.name}<b>{t.level === undefined ? "—" : `${Number(t.level).toFixed(1)} cm`}</b><em>{t.risk === "STALE" ? "OFFLINE" : t.risk}</em></li>)}</ul>)}
        </div>
      </div>

      <section className="landing-section" id="how-it-works">
        <Reveal className="section-heading"><p className="eyebrow">01 · THE SIGNAL PATH</p><h2>From a reading<br />to a <em>response.</em></h2><p>Every warning follows a visible chain. Open any step to see exactly what happens there.</p></Reveal>
        <div className="pipeline">
          <div className="pipe-line" aria-hidden="true"><motion.i style={{ scaleX: pipeScale }} /></div>
          {steps.map((s, i) => <Reveal key={s.n} delay={i * .08} className="pipe-wrap"><Spotlight className="pipe-card"><button onClick={() => setStepOpen(s)} aria-label={`${s.title}: learn more`}>
            <span className="pipe-n">{s.n}</span><span className="pipe-ico"><s.icon size={20} strokeWidth={1.7} /></span><h3>{s.title}</h3><p>{s.short}</p><span className="pipe-more">Details <ArrowRight size={13} /></span>
          </button></Spotlight></Reveal>)}
        </div>
      </section>

      <section className="landing-section" id="network">
        <Reveal className="section-heading split"><div><p className="eyebrow">02 · RIVER BASINS</p><h2>{basins.length ? `${basins.length} basins.` : "Many basins."}<br /><em>One signal path.</em></h2></div><p>Pick a basin to see its stations and settlements at their real positions, then send a flood wave down the river.</p></Reveal>
        <Reveal className="explorer">
          <div className="explorer-tabs" role="tablist" aria-label="Basin">{basins.map((b) => <button key={b.basin_id} role="tab" aria-selected={active?.basin_id === b.basin_id} className={active?.basin_id === b.basin_id ? "on" : ""} onClick={() => setActiveId(b.basin_id)}>
            <span className={`state-dot ${b.open_alerts ? "alert" : "calm"}`} /><b>{b.name}</b><small>{b.stations} stations</small></button>)}</div>
          <div className="explorer-body">
            <AnimatePresence mode="wait">
              {active && <motion.div key={active.basin_id} initial={reduced ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: -24 }} transition={{ duration: .35 }} className="explorer-panel">
                <div className="explorer-info">
                  <p className="basin-region">{active.region}</p>
                  <h3>{active.name}{active.name_ne ? <span lang="ne"> · {active.name_ne}</span> : null}</h3>
                  <p>{active.description}</p>
                  <dl><div><dt>Stations</dt><dd>{active.stations}</dd></div><div><dt>Settlements</dt><dd>{active.settlements}</dd></div><div><dt>Open alerts</dt><dd>{active.open_alerts || 0}</dd></div></dl>
                  <div className="basin-card-actions"><button className="landing-primary" onClick={() => openBasin(active.basin_id)}>Open dashboard <ArrowRight size={14} /></button><button className="landing-secondary" onClick={() => openBasin(active.basin_id, "/bulletin")}>Bulletin</button></div>
                  {active.simulated && <small className="demo-data">Sensor readings are simulated. Locations are real river sites.</small>}
                </div>
                <BasinExplorer basin={active} nodes={activeNodes} settlements={activeSettlements} live={live} onOpenStation={setStationOpen} />
              </motion.div>}
            </AnimatePresence>
          </div>
        </Reveal>
      </section>

      <section className="landing-section numbers-section">
        {[[basins.length, "", "river basins"], [nodes.length, "", "stations listening"], [settlements.length, "", "settlements covered"], [5, "s", "reading interval"]].map(([v, suffix, label], i) => <Reveal key={label} delay={i * .08} className="number-item"><strong><CountUp value={v} suffix={suffix} /></strong><span>{label}</span></Reveal>)}
      </section>

      <section className="landing-section" id="features">
        <Reveal className="section-heading"><p className="eyebrow">03 · THE OPERATING MODEL</p><h2>Decisions with<br /><em>a visible reason.</em></h2></Reveal>
        <div className="feature-grid">{features.map(([title, copy, Icon], i) => <Reveal key={title} delay={(i % 3) * .08}><Spotlight className="feature-card"><span className="feature-ico"><Icon size={20} strokeWidth={1.7} /></span><h3>{title}</h3><p>{copy}</p></Spotlight></Reveal>)}</div>
      </section>

      <section className="landing-section safety-section" id="safety">
        <Reveal className="safety-copy"><p className="eyebrow">04 · WHEN A WARNING ARRIVES</p><h2>Know the next<br /><em>safe step.</em></h2><p>Move to higher ground when instructed. Take medicines, documents and water. Follow local responders and check the public bulletin for current settlement guidance.</p><button className="btn-accent" onClick={() => navigate("/bulletin")}>Open safety bulletin <ArrowRight size={15} /></button></Reveal>
        <div className="safety-steps">{["Hear the warning", "Move to the evacuation point", "Stay until all-clear"].map((t, i) => <Reveal key={t} delay={i * .12}><div className="safety-step"><span>{i + 1}</span><b>{t}</b></div></Reveal>)}</div>
      </section>
    </main>

    <footer className="landing-footer"><Logo variant="full" /><div><span>{brand.title} · River early warning for Nepal</span><small>React · FastAPI · MQTT · Leaflet · Academic final-year project</small></div><div className="landing-credit"><strong>Credits</strong><span>{credits.team} · {credits.institution}</span><small>{credits.contact}</small></div><button onClick={() => navigate("/app/monitor")}>Operations dashboard <ArrowRight size={14} /></button></footer>

    {stepOpen && <Modal title={`${stepOpen.n} · ${stepOpen.title}`} description={stepOpen.short} onClose={() => setStepOpen(null)}>
      <div className="modal-body"><p>{stepOpen.long}</p><ul className="modal-list">{stepOpen.points.map((p) => <li key={p}>{p}</li>)}</ul></div>
    </Modal>}
    {stationOpen && (() => {
      const r = live[stationOpen.node_id] || stationOpen.latest_reading || {};
      const risk = r.risk_level || stationOpen.current_risk || "NORMAL";
      return <Modal title={stationOpen.name} description={`${stationOpen.node_id} · ${stationOpen.elevation_m} m elevation`} onClose={() => setStationOpen(null)}>
        <div className="modal-body">
          <p><span className={`risk-label ${risk}`}><i /> {risk === "STALE" ? "OFFLINE" : risk}</span></p>
          <dl className="modal-readings"><div><dt>Water level</dt><dd>{r.water_level_cm === undefined ? "—" : `${Number(r.water_level_cm).toFixed(1)} cm`}</dd></div><div><dt>Rainfall</dt><dd>{r.rainfall_mm === undefined ? "—" : `${Number(r.rainfall_mm).toFixed(1)} mm`}</dd></div><div><dt>Soil moisture</dt><dd>{r.soil_moisture_pct === undefined ? "—" : `${Number(r.soil_moisture_pct).toFixed(0)} %`}</dd></div><div><dt>HSI score</dt><dd>{r.hsi_score === undefined ? "—" : Number(r.hsi_score).toFixed(2)}</dd></div></dl>
          <p className="modal-note">Position {stationOpen.lat.toFixed(4)}, {stationOpen.lng.toFixed(4)}. {stationOpen.description}</p>
          <button className="landing-primary" onClick={() => openBasin(stationOpen.basin_id)}>Open in dashboard <ArrowRight size={14} /></button>
        </div>
      </Modal>;
    })()}
  </div>;
}
