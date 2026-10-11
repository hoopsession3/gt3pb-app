"use client";

import { useEffect, useState } from "react";
import { addDays, etToday } from "./dates";
import { etDayStart } from "./etDay";

// THE BUSINESS DAY, KEPT CURRENT (2026-10-11). Cards read "today" when they load and say "Today", "Tomorrow" or
// "This Sat" when they render, so a screen that stays up through midnight (the Pass holds the phone awake) kept
// yesterday's until something else changed. This is the ET day, updated at the turn of the day and checked again
// whenever the app comes back (a phone pauses timers while it sleeps). The crew page reads every live screen again
// when it changes (lib/realtime refreshLive).
export function useEtDay(): string {
  const [day, setDay] = useState(etToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => setDay((d) => { const t = etToday(); return t === d ? d : t; });
    const arm = () => {
      if (timer) clearTimeout(timer);
      const next = etDayStart(addDays(etToday(), 1)).getTime();
      timer = setTimeout(() => { check(); arm(); }, Math.max(1_000, next - Date.now() + 500));
    };
    const onVis = () => { if (document.visibilityState === "visible") { check(); arm(); } };
    arm();
    document.addEventListener("visibilitychange", onVis);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return day;
}
