// ONE READ FOR A BURST OF CHANGES (R11, 2026-10-16 — the 10/10 audit). Every realtime change to a table re-ran the whole
// read of every screen showing it, one read per row: fifteen task rows inserted at once were fifteen full reloads on
// every device watching, and a busy service turned the feed into a storm of reads. lib/realtime runs each screen's read
// through this: the first change waits RUSH_MS for the rest of its burst, and a steady stream is still read at least every
// RUSH_MAX_MS, so nothing waits long. Pure but for the timer it is handed, so a test turns the clock by hand.
export const RUSH_MS = 300;
export const RUSH_MAX_MS = 1_000;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function coalesce(run: () => void, now: () => number = Date.now, timers: Timers = realTimers): { poke: () => void; cancel: () => void } {
  let timer: unknown = null, first = 0;
  const fire = () => { timer = null; first = 0; run(); };
  return {
    poke: () => {
      const t = now();
      if (!first) first = t;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(fire, t - first >= RUSH_MAX_MS ? 0 : RUSH_MS);
    },
    cancel: () => { if (timer !== null) timers.clear(timer); timer = null; first = 0; },
  };
}
