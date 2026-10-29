import React from "react";
import { brand } from "../config/brand";

// Mark: a twin-peaked ridge, a river winding out of it, and a vermilion station beacon.
export default function Logo({ variant = "full", className = "" }) {
  const mark = (
    <svg className={`logo-mark ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden={variant !== "full"}>
      <path d="M5 44 22 17l8 12 7-9 22 24" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 55c9-8 15 3 24-4s14-1 24-7" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <circle className="logo-beacon" cx="49" cy="14" r="5" />
    </svg>
  );
  if (variant === "mark") return mark;
  return <span className="logo-lockup">{mark}<span><strong>{brand.title}</strong><small>{brand.tagline}</small></span></span>;
}
