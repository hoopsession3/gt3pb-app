"use client";

import { useEffect, useRef, useState } from "react";
import type { Layout } from "@/lib/vision";
import { DEFAULTS, flowStats, heatSquares, makeSim, step, type FlowStats, type Phase } from "@/lib/visionFlow";

// FLOW, RUNNING (R52). One simulation of the room (lib/visionFlow) per layout, stepped on the screen's clock at a chosen
// speed — a minute of the room in two seconds at ×30 — and handed to the plan and the 3D view about fifteen times a
// second (the simulation itself runs every frame). Moving a thing starts the room over, empty: a new layout is a new day.
// Changing the speed or the guests an hour doesn't — it carries on with the new pace.
export type FlowFrame = {
  guests: { id: number; x: number; y: number; phase: Phase }[];
  heat: { x: number; y: number; size: number; v: number }[];
  stats: FlowStats;
  problem: string | null;
  minutes: number;
};
/** Seconds of the room run before it is shown. */
export const WARM_SEC = 900;
export const SPEEDS = [10, 30, 60] as const;
export type Speed = (typeof SPEEDS)[number];

/** The layout's shape, as the simulation sees it: where things are and how big. Names and reasons don't change a walk. */
const shapeOf = (l: Pick<Layout, "width_in" | "depth_in" | "items">) =>
  `${l.width_in}x${l.depth_in}|${l.items.map((i) => `${i.id}:${i.kind}:${i.x_in},${i.y_in},${i.rot},${i.w_in},${i.d_in},${i.h_in}`).join(";")}`;

export function useFlow(layout: Pick<Layout, "width_in" | "depth_in" | "items">, on: boolean, perHour: number, speed: Speed): FlowFrame | null {
  const [frame, setFrame] = useState<FlowFrame | null>(null);
  const pace = useRef({ perHour, speed });
  useEffect(() => { pace.current = { perHour, speed }; }, [perHour, speed]);
  const room = useRef(layout);
  useEffect(() => { room.current = layout; }, [layout]);
  const shape = shapeOf(layout);

  useEffect(() => {
    if (!on) return;
    const L = room.current;
    const sim = makeSim(L, { ...DEFAULTS, perHour: pace.current.perHour }, 7);
    // The room opens a quarter-hour into a morning — people already in line and at the tables — so the first numbers
    // on screen describe a room in use, not an empty one waiting for its first guest.
    // (Whole seconds: ~8 ms, so a thing dragged with Flow running restarts the room without a stutter.)
    for (let k = 0; k < WARM_SEC; k++) step(sim, 1);
    const show = () => setFrame({
      guests: sim.guests.map((g) => ({ id: g.id, x: g.at.x, y: g.at.y, phase: g.phase })),
      heat: heatSquares(sim), stats: flowStats(sim, L.items), problem: sim.problem, minutes: Math.floor(sim.t / 60),
    });
    let raf = 0, last = performance.now(), shown = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      sim.settings.perHour = pace.current.perHour;
      // The room's seconds this frame, in steps of at most a quarter second (a walk around a corner stays a walk).
      let left = dt * pace.current.speed;
      while (left > 0) { const d = Math.min(0.25, left); step(sim, d); left -= d; }
      if (now - shown > 66) { shown = now; show(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `shape` is the layout as the simulation sees it; the layout itself is read through the ref.
  }, [on, shape]);

  return on ? frame : null;
}
