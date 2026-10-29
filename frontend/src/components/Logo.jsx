import React from "react";
import { brand } from "../config/brand";

export default function Logo({ variant = "full", className = "" }) {
  const mark = (
    <svg className={`logo-mark ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden={variant !== "full"}>
      <path d="M8 45c8-12 12 7 20-5s12 7 20-7c3-5 5-8 8-9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M8 51c8-8 12 5 20-3s12 5 20-5c3-4 5-6 8-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".55" />
      <path d="M32 10 45 30H19L32 10Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
  if (variant === "mark") return mark;
  return <span className="logo-lockup">{mark}<span><strong>{brand.name}</strong><small>{brand.tagline}</small></span></span>;
}
