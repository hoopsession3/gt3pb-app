"use client";

import { useEffect } from "react";

// THE SCREEN STAYS ON (2026-10-11). Two screens are watched from arm's length for an hour at a time: the Pass
// (app/crew/page.tsx), and the truck's live dot while this phone broadcasts it (components/crew/LiveControl). A phone
// that dims and locks mid-rush stops ringing for new orders; a locked one stops sending the truck's position. While
// `on`, the Screen Wake Lock asks the browser to keep the screen on.
//
// The browser lets the lock go whenever the page is hidden — another app, the phone locked by hand — so it is asked
// for again each time the page is back. And it is a request, not a promise: a browser without the API (an iPhone
// before iOS 16.4) or one that refuses (Low Power Mode, a page not visible yet) leaves the screen to the phone's own
// auto-lock, and nothing else changes. Only the console loads this.
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    const api: WakeLock | undefined = typeof navigator !== "undefined" ? navigator.wakeLock : undefined;
    if (!on || !api) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false, live = true;
    const ask = async () => {
      if (asking || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      asking = true;
      try {
        const got = await api.request("screen");
        if (live) lock = got; else void got.release().catch(() => {});
      } catch { /* refused: the phone's own auto-lock stands */ }
      asking = false;
    };
    const onVis = () => { void ask(); };
    void ask();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [on]);
}
