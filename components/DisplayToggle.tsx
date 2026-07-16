"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";

// READABILITY CONTROLS — a global "Aa" toggle (every surface, users + operators): bump the text
// size, make text bolder, and open up the spacing so info is easier to scan. Persisted to
// localStorage and applied app-wide via classes on `.app` (see AppShell). Zero backend.

export type Display = { scale: 0 | 1 | 2 | 3; bold: boolean; roomy: boolean };
export const DISPLAY_KEY = "gt3-display";
const DEFAULT: Display = { scale: 0, bold: false, roomy: false };

export function readDisplay(): Display {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "{}");
    return {
      scale: [0, 1, 2, 3].includes(raw.scale) ? raw.scale : 0,
      bold: !!raw.bold, roomy: !!raw.roomy,
    };
  } catch { return DEFAULT; }
}
// the classes AppShell adds to `.app` for a given preference set
export function displayClass(d: Display): string {
  return [d.scale ? `rd-t${d.scale}` : "", d.bold ? "rd-bold" : "", d.roomy ? "rd-roomy" : ""].filter(Boolean).join(" ");
}
function write(d: Display) {
  try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(DISPLAY_KEY)); // live-apply in AppShell
}

const SIZES: { v: Display["scale"]; label: string }[] = [
  { v: 0, label: "A" }, { v: 1, label: "A" }, { v: 2, label: "A" }, { v: 3, label: "A" },
];

export default function DisplayToggle() {
  const [d, setD] = useState<Display>(DEFAULT);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);
  useEffect(() => { setD(readDisplay()); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const set = (patch: Partial<Display>) => { const next = { ...d, ...patch }; setD(next); write(next); };

  return (
    <div className="rdg" ref={ref}>
      {open && (
        <div className="rdg-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-label="Display & text">
          <div className="rdg-row-h">Text size</div>
          <div className="rdg-sizes">
            {SIZES.map((s, i) => (
              <button key={s.v} type="button" className={`rdg-size${d.scale === s.v ? " on" : ""}`} style={{ fontSize: 12 + i * 3 }} onClick={() => set({ scale: s.v })} aria-pressed={d.scale === s.v} aria-label={`Text size ${i + 1}`}>{s.label}</button>
            ))}
          </div>
          <button type="button" className={`rdg-opt${d.bold ? " on" : ""}`} onClick={() => set({ bold: !d.bold })} aria-pressed={d.bold}>
            <b>Bold text</b><span>{d.bold ? "On" : "Off"}</span>
          </button>
          <button type="button" className={`rdg-opt${d.roomy ? " on" : ""}`} onClick={() => set({ roomy: !d.roomy })} aria-pressed={d.roomy}>
            <span>Roomy spacing</span><span>{d.roomy ? "On" : "Off"}</span>
          </button>
          {(d.scale || d.bold || d.roomy) ? (
            <button type="button" className="rdg-reset" onClick={() => set({ scale: 0, bold: false, roomy: false })}>Reset</button>
          ) : null}
        </div>
      )}
      <button type="button" className="rdg-fab" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Display & text size">
        <span className="rdg-aa" aria-hidden><span className="rdg-a" style={{ fontSize: 12 }}>A</span><span className="rdg-a" style={{ fontSize: 18 }}>A</span></span>
        <span className="rail-txt"><b>Display</b><i>text size · contrast</i></span>
      </button>
    </div>
  );
}
