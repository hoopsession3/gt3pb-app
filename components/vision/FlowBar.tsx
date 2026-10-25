"use client";

import { Segmented } from "@/components/controls";
import { haptic } from "@/lib/haptics";
import { PHASE_COLOR, flowWords, type Phase } from "@/lib/visionFlow";
import type { Figure } from "@/lib/vision3d";
import { SPEEDS, type FlowFrame, type Speed } from "./useFlow";

// FLOW'S CONTROLS AND NUMBERS (R52). Start and stop it, how many guests an hour, how fast the room's clock runs — and
// what's happening: who's in, the line, the seats, the pace the counter keeps, the average visit, where it's busiest,
// and a sentence that says what that means. The designer shows all of it; the presenter (`compact`) the switch and the
// sentence. The numbers change many times a second, so they aren't a live region — the sentence is, and it changes
// only when its meaning does.
const STEPS: [Phase, string][] = [["in", "Walking in"], ["queue", "In line"], ["order", "Ordering"], ["pickup", "Picking up"], ["seated", "Staying"], ["grab", "A bottle to go"], ["out", "Leaving"]];

export const figuresOf = (f: FlowFrame | null): Figure[] | undefined =>
  f ? f.guests.map((g) => ({ x: g.x, y: g.y, color: PHASE_COLOR[g.phase], seated: g.phase === "seated" })) : undefined;

export default function FlowBar({ on, onToggle, perHour, onPerHour, speed, onSpeed, frame, compact = false }: {
  on: boolean; onToggle: () => void; perHour: number; onPerHour: (n: number) => void; speed: Speed; onSpeed: (s: Speed) => void;
  frame: FlowFrame | null; compact?: boolean;
}) {
  const st = frame?.stats;
  const words = frame?.problem ?? (st ? flowWords(st, perHour) : null);
  const toggle = <button type="button" className={on ? "btn-pri btn-sm" : "btn-sec btn-sm"} aria-pressed={on} onClick={() => { haptic("selection"); onToggle(); }}>{on ? "❚❚ Stop the flow" : "▶ Run the flow"}</button>;
  if (compact) {
    return (
      <div className="vz-flow compact">
        {toggle}
        <p className={frame?.problem ? "vz-issue error" : "vz-flow-say"} aria-live="polite">{on && words ? words : ""}</p>
      </div>
    );
  }
  return (
    <div className="vz-flow" aria-label="Flow — guests moving through the room">
      <div className="vz-row">
        {toggle}
        <label className="vz-rate">
          <span>Guests an hour <b>{perHour}</b></span>
          <input type="range" min={10} max={200} step={10} value={perHour} onChange={(e) => onPerHour(Number(e.target.value))} aria-label="Guests an hour" />
        </label>
        <Segmented label="How fast" kind="choice" size="sm" value={String(speed)} onChange={(v) => onSpeed(Number(v) as Speed)}
          options={SPEEDS.map((s) => ({ key: String(s), label: `×${s}` }))} />
      </div>
      {on && frame && !frame.problem && st && (
        <p className="vz-stats">
          <span><b>{frame.minutes}</b> min in</span>
          <span><b>{st.inside}</b> inside</span>
          <span><b>{st.inLine}</b> in line · longest <b>{st.maxLine}</b></span>
          <span><b>{st.seated}</b> of <b>{st.seats}</b> seats</span>
          <span><b>{st.servedPerHour}</b> served an hour</span>
          <span><b>{st.avgVisitMin}</b> min a visit</span>
        </p>
      )}
      {/* Mounted before its words, so a reader hears them arrive (spoken.audit). */}
      <p className={frame?.problem ? "vz-issue error" : "vz-flow-say"} aria-live="polite">{on && words ? words : ""}</p>
      {on && !frame?.problem && (
        <div className="vz-legend" aria-hidden="true">
          {STEPS.map(([p, w]) => <span key={p}><i className={`ph-${p}`} />{w}</span>)}
          <span><i className="ph-heat" />Where it&apos;s busiest</span>
        </div>
      )}
    </div>
  );
}
