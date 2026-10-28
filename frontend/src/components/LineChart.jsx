import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "../lib/format";

const MARGIN = { top: 12, right: 12, bottom: 24, left: 46 };
const THRESHOLD_STYLE = [["watch", "WATCH"], ["warning", "WARNING"], ["critical", "CRITICAL"]];

// The API names thresholds water_level_watch / _warning / _critical.
const limitFor = (thresholds, key) => thresholds?.[`water_level_${key}`] ?? thresholds?.[key];

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || rough;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

// Pixel-accurate SVG line chart sized to its container, with a hover read-out.
// points: [{ t: epoch ms, v: number }], thresholds: { watch, warning, critical }
export default function LineChart({ points, thresholds = {}, unit = "", height = 220, showThresholds = true, ariaLabel = "Time series chart", empty = "Waiting for readings…" }) {
  const host = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!host.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    if (points.length < 2) return null;
    const limits = showThresholds ? THRESHOLD_STYLE.map(([key]) => limitFor(thresholds, key)).filter(Number.isFinite) : [];
    const values = points.map((p) => p.v);
    const dataMin = Math.min(...values), dataMax = Math.max(...values);
    // Include a threshold only when it is near the data, so a flat normal line is not squashed by a far-away critical line.
    const reach = Math.max((dataMax - dataMin) * 1.5, 25);
    const near = limits.filter((limit) => limit <= dataMax + reach && limit >= dataMin - reach);
    const lo = Math.min(dataMin, ...near), hi = Math.max(dataMax, ...near);
    const pad = Math.max((hi - lo) * 0.1, 1);
    const yMin = Math.max(0, lo - pad), yMax = hi + pad;
    const innerW = width - MARGIN.left - MARGIN.right, innerH = height - MARGIN.top - MARGIN.bottom;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    const x = (t) => MARGIN.left + ((t - t0) / Math.max(t1 - t0, 1)) * innerW;
    const y = (v) => MARGIN.top + (1 - (v - yMin) / Math.max(yMax - yMin, 1e-6)) * innerH;
    return { x, y, yMin, yMax, t0, t1, innerH, ticks: niceTicks(yMin, yMax), near };
  }, [points, thresholds, showThresholds, width, height]);

  if (!model) return <div ref={host} className="chart-empty" style={{ height }}>{empty}</div>;
  const { x, y, ticks, t0, t1, near } = model;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${MARGIN.top + model.innerH} L${x(t0).toFixed(1)},${MARGIN.top + model.innerH} Z`;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + (t1 - t0) * f);

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const target = t0 + ((event.clientX - rect.left - MARGIN.left) / (width - MARGIN.left - MARGIN.right)) * (t1 - t0);
    let best = points[0];
    for (const p of points) if (Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
    setHover(best);
  };

  return <div ref={host} className="line-chart" style={{ height }}>
    <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {ticks.map((tick) => <g key={tick}><line className="lc-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} /><text className="lc-axis" x={MARGIN.left - 6} y={y(tick) + 3} textAnchor="end">{tick % 1 ? tick.toFixed(1) : tick}</text></g>)}
      {xTicks.map((t, i) => <text key={i} className="lc-axis" x={x(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{formatClock(new Date(t))}</text>)}
      {showThresholds && THRESHOLD_STYLE.map(([key, label], index) => { const limit = limitFor(thresholds, key); return near.includes(limit) && <g key={key}><line className={`lc-threshold t${index}`} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(limit)} y2={y(limit)} /><text className={`lc-threshold-label t${index}`} x={width - MARGIN.right - 4} y={y(limit) - 4} textAnchor="end">{label} {limit}</text></g>; })}
      <path className="lc-area" d={area} />
      <path className="lc-line" d={path} />
      {hover && <g><line className="lc-cursor" x1={x(hover.t)} x2={x(hover.t)} y1={MARGIN.top} y2={MARGIN.top + model.innerH} /><circle className="lc-dot" cx={x(hover.t)} cy={y(hover.v)} r="4" /></g>}
    </svg>
    {hover && <div className="lc-tooltip" style={{ left: Math.min(Math.max(x(hover.t), 70), width - 70), top: Math.max(y(hover.v) - 44, 0) }}><b>{Number(hover.v).toFixed(2)} {unit}</b><span>{formatClock(new Date(hover.t), true)} NPT</span></div>}
  </div>;
}
