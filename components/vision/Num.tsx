"use client";

import { useState } from "react";

// A NUMBER FIELD FOR THE MODEL (R54–R55): empty is "not set" (null), never zero; dollars typed, cents kept. What's typed
// stays as typed ("12." on the way to "12.5") until it reads as a different number than the field holds.
export default function Num({ label, value, set, unit, cents = false }: { label: string; value: number | null; set: (v: number | null) => void; unit?: string; cents?: boolean }) {
  const shown = value == null ? "" : String(cents ? value / 100 : value);
  const [raw, setRaw] = useState(shown);
  const [was, setWas] = useState(shown);
  if (was !== shown) { setWas(shown); if (parseNum(raw) !== parseNum(shown)) setRaw(shown); }
  return (
    <label className="prod-f"><span>{label}{unit ? ` (${unit})` : ""}</span>
      <input inputMode="decimal" value={raw} onChange={(e) => { setRaw(e.target.value); const v = parseNum(e.target.value); set(v == null ? null : cents ? Math.round(v * 100) : v); }} /></label>
  );
}
export const parseNum = (s: string): number | null => { const t = s.replace(/[$,%\s]/g, ""); if (!t) return null; const v = Number(t); return Number.isFinite(v) ? v : null; };
