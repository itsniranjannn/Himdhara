import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible dialog: Esc and backdrop close it, Tab stays inside, focus returns to the opener.
export default function Modal({ title, description, onClose, children, onSubmit }) {
  const titleId = useId();
  const panel = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    const first = panel.current?.querySelector("input, select, textarea") || panel.current?.querySelector(FOCUSABLE);
    first?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);

  const Wrapper = onSubmit ? "form" : "div";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <Wrapper ref={panel} className="demo-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={onSubmit}>
      <div className="modal-heading">
        <div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button>
      </div>
      {children}
    </Wrapper>
  </div>;
}
