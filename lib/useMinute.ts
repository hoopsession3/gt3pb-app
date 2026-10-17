"use client";

import { useSyncExternalStore } from "react";

// THE CLOCK, A MINUTE AT A TIME (2026-10-11, the dispatch round). "Late" is the clock against a window, and a cup
// placed ahead leaves Due next the minute its time comes. Neither changes a row in the database, so a screen that only
// read again on a change would say "on time" all morning. This is the minute, read while rendering (no effect copying
// it into state, no Date.now() in a render): the same number to every reader until the minute turns, checked every
// fifteen seconds and again when the app comes back (a phone pauses timers while it sleeps). The crew's screens read
// it, and Find Us (R16: its live tag and ordering window, where a render read Date.now()).
let minute = 0;
function read(): number {
  const m = Math.floor(Date.now() / 60_000) * 60_000;
  if (m !== minute) minute = m;
  return minute;
}
function subscribe(changed: () => void): () => void {
  const t = setInterval(changed, 15_000);
  const onVis = () => { if (document.visibilityState === "visible") changed(); };
  document.addEventListener("visibilitychange", onVis);
  return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
}

/** The current minute, as epoch ms (seconds dropped). */
export function useMinute(): number {
  return useSyncExternalStore(subscribe, read, read);
}
