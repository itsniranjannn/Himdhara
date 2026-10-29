// Verifies WCAG 2.1 contrast for the design tokens in src/styles/tokens.css.
// Usage: npm run check:contrast   (exits 1 when any pair fails)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) { end = i; break; }
  }
  return css.slice(open + 1, end);
}
function tokens(body) {
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
const dark = tokens(block(":root"));
const light = { ...dark, ...tokens(block('[data-theme="light"]')) };

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// [foreground token, background token, minimum ratio, what it is used for]
const PAIRS = [
  ...["surface-0", "surface-1", "surface-2", "surface-3"].flatMap((bg) => [
    ["text-1", bg, 7, "primary text"], ["text-2", bg, 4.5, "secondary text"], ["text-3", bg, 4.5, "muted text"],
  ]),
  ...["surface-0", "surface-1", "surface-2"].flatMap((bg) => [
    ["brand", bg, 4.5, "links and active tabs"],
    ["normal", bg, 4.5, "NORMAL label"], ["watch", bg, 4.5, "WATCH label"], ["warning", bg, 4.5, "WARNING label"],
    ["critical", bg, 4.5, "CRITICAL label"], ["stale", bg, 4.5, "OFFLINE label"],
  ]),
  ...["surface-0", "surface-1"].map((bg) => ["accent", bg, 4.5, "accent highlights"]),
  ["on-brand", "brand", 4.5, "text on primary buttons"],
  ["on-accent", "accent", 4.5, "text on accent buttons"],
];

let failures = 0;
for (const [name, theme] of [["dark", dark], ["light", light]]) {
  console.log(`\n${name.toUpperCase()} THEME`);
  for (const [fg, bg, min, use] of PAIRS) {
    const value = ratio(theme[fg], theme[bg]);
    const ok = value >= min;
    if (!ok) failures++;
    console.log(`${ok ? "pass" : "FAIL"}  ${value.toFixed(2).padStart(5)}:1  (need ${min})  ${fg} on ${bg}  - ${use}`);
  }
}
console.log(failures ? `\n${failures} pair(s) below the WCAG threshold.` : "\nAll pairs meet WCAG AA.");
process.exit(failures ? 1 : 0);
