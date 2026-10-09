"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { devicePref, useDevicePref } from "@/lib/devicePref";
import { TEXT_SIZE_WORDS } from "@/lib/textSize";
import { usePhoneTextTier } from "./usePhoneText";

// READABILITY CONTROLS — a global "Aa" toggle (every surface, users + operators): bump the text
// size, make text bolder, and open up the spacing so info is easier to scan. Persisted to
// localStorage and applied app-wide via classes on `.app` (see AppShell). Zero backend.
//
// TWO PLACES, ONE SET OF CONTROLS (2026-10-06, the settings round). Settings › You › Display
// size draws the same controls as the rail's panel (DisplayControls, below), and the rail stays.
// Both read the one stored value through lib/devicePref, so a size picked in Settings is the size
// the rail shows when it opens. Before, the rail read its copy once when it mounted, and its next
// tap would have written the old size back over the new one.

export type Display = { scale: 0 | 1 | 2 | 3; bold: boolean; roomy: boolean };
export const DISPLAY_KEY = "gt3-display";
const DISPLAY = devicePref(DISPLAY_KEY);
const DEFAULT: Display = { scale: 0, bold: false, roomy: false };

/** What a stored value means. Anything unreadable is the default. */
export function displayFrom(raw: string | null | undefined): Display {
  try {
    const v = JSON.parse(raw || "{}");
    return {
      scale: [0, 1, 2, 3].includes(v.scale) ? v.scale : 0,
      bold: !!v.bold, roomy: !!v.roomy,
    };
  } catch { return DEFAULT; }
}
/** The display preferences this render should draw. The default on the server and while hydrating. Until
 *  someone picks a text size, the iPhone app draws the one nearest the phone's own (lib/phoneText). */
export function useDisplay(): Display {
  const raw = useDevicePref(DISPLAY);
  const phone = usePhoneTextTier();
  return raw == null ? { ...DEFAULT, scale: phone } : displayFrom(raw);
}
// the classes AppShell adds to `.app` for a given preference set
export function displayClass(d: Display): string {
  return [d.scale ? `rd-t${d.scale}` : "", d.bold ? "rd-bold" : "", d.roomy ? "rd-roomy" : ""].filter(Boolean).join(" ");
}
function write(d: Display) {
  DISPLAY.write(JSON.stringify(d)); // live-apply in AppShell and in every copy of the controls
}

const SIZES: readonly Display["scale"][] = [0, 1, 2, 3];

/** Text size, bold and spacing. Drawn in the rail's panel and in Settings › You. */
export function DisplayControls() {
  const d = useDisplay();
  const stored = useDevicePref(DISPLAY) != null;
  const phone = usePhoneTextTier();
  const set = (patch: Partial<Display>) => write({ ...d, ...patch });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="rdg-row-h">Text size</div>
      <div className="rdg-sizes">
        {/* Each "A" is named for what it does (lib/textSize's words — Settings' row says the one picked). */}
        {SIZES.map((v) => (
          <button key={v} type="button" className={`rdg-size${d.scale === v ? " on" : ""}`} style={{ fontSize: 12 + v * 3 }} onClick={() => set({ scale: v })} aria-pressed={d.scale === v} aria-label={`Text size: ${TEXT_SIZE_WORDS[v]}`}>A</button>
        ))}
      </div>
      <button type="button" className={`rdg-opt${d.bold ? " on" : ""}`} onClick={() => set({ bold: !d.bold })} aria-pressed={d.bold}>
        <b>Bold text</b><span>{d.bold ? "On" : "Off"}</span>
      </button>
      <button type="button" className={`rdg-opt${d.roomy ? " on" : ""}`} onClick={() => set({ roomy: !d.roomy })} aria-pressed={d.roomy}>
        <span>Roomy spacing</span><span>{d.roomy ? "On" : "Off"}</span>
      </button>
      {/* Reset forgets the choice: the standard size again, or in the iPhone app the phone's own. */}
      {stored && (d.scale !== phone || d.bold || d.roomy) ? (
        <button type="button" className="rdg-reset" onClick={() => DISPLAY.clear()}>Reset</button>
      ) : null}
    </div>
  );
}

export default function DisplayToggle() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);
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

  return (
    <div className="rdg" ref={ref}>
      {open && (
        <div className="rdg-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-label="Display & text">
          <DisplayControls />
        </div>
      )}
      <button type="button" className="rdg-fab" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Display & text size">
        <span className="rdg-aa" aria-hidden><span className="rdg-a" style={{ fontSize: 12 }}>A</span><span className="rdg-a" style={{ fontSize: 18 }}>A</span></span>
        <span className="rail-txt"><b>Display</b><i>text size · contrast</i></span>
      </button>
    </div>
  );
}
