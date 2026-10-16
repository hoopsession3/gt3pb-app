// A BANNER'S WINDOW, KEPT BY THE SCREEN AS WELL AS THE READ (R13, 2026-10-16 — the 10/10 audit's performance pass, F15).
//
// The banner hook said it re-checked each banner's window "so a scheduled end hides it without waiting for a refetch" —
// and checked it only when it read. A banner whose end passed stayed up on a screen left open — the Pass, the TV board —
// until something else changed or the phone came back after half a minute away. The screen now keeps the window itself:
// it asks when the next start or end is (nextEdge) and looks again then. Pure.

type Windowed = { starts_at: string | null; ends_at: string | null };

/** Whether a banner is up at `nowMs`: started (or no start), not yet ended (or no end). */
export function inWindow(b: Windowed, nowMs: number): boolean {
  return (!b.starts_at || Date.parse(b.starts_at) <= nowMs) && (!b.ends_at || Date.parse(b.ends_at) >= nowMs);
}

/** The next moment after `nowMs` when a banner starts or ends — when the screen should look again. null: none ahead. */
export function nextEdge(rows: readonly Windowed[], nowMs: number): number | null {
  let next: number | null = null;
  for (const b of rows) {
    for (const at of [b.starts_at, b.ends_at]) {
      if (!at) continue;
      // An end is still "up" at its own moment (inWindow's >=): the screen looks again just after it.
      const t = Date.parse(at) + (at === b.ends_at ? 1 : 0);
      if (Number.isFinite(t) && t > nowMs && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/** setTimeout cannot wait longer than this (about 24.8 days); a later edge is looked at again after it. */
export const LONGEST_WAIT_MS = 2 ** 31 - 1;
