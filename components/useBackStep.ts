"use client";

import { useEffect, useEffectEvent } from "react";
import { appHistory } from "@/lib/appHistory";

// A VIEW A SCREEN OPENS INSIDE ITSELF, AS A STEP (2026-10-08, the navigation round; its own file 2026-10-11). The title
// bar on every page reads components/useBack; only the screens that open views — the crew console, the Academy, the
// system map — read this, so the guest pages' bundles carry none of it (scripts/design.ratchet.mjs WEIGHT: /shop sat
// within bytes of its ceiling when the click below joined it).

// WHERE THE SCREEN WAS WHEN THE VIEW WAS ASKED FOR (2026-10-11, measured on Readiness: a stop opened from 100px down
// the list came back to its top). It is read at the click that opens the view, before anything is drawn — by the time
// the view's effect runs, the screen may already show the view's loading line, and a page that short has pulled the
// scroll to 0. A view opened by no click (a deep link, the live event opening itself) reads the scroll as it stands.
let clickAt = { t: -Infinity, y: 0 };
if (typeof document !== "undefined") {
  document.addEventListener("click", () => { clickAt = { t: performance.now(), y: document.getElementById("body")?.scrollTop ?? 0 }; }, { capture: true, passive: true });
}

/** A view a screen opens inside itself — an Academy lesson, a layer of the system map — is a step: Back (the
 *  bar's ‹, the edge swipe, Android's, the browser's) closes it, and the bar names where that goes
 *  ("‹ Academy"), where the view used to carry a ‹ of its own that scrolled away. `label` null: no step. */
export function useBackStep(label: string | null, close: () => void): void {
  const closeNow = useEffectEvent(close);
  useEffect(() => {
    if (!label) return;
    // The view opens at its top, and the screen it was opened from comes back where it was left — as a view
    // pushed on an iPhone does. (A lesson used to open as far down as its list had been scrolled.)
    const body = document.getElementById("body");
    const was = performance.now() - clickAt.t < 1000 ? clickAt.y : body?.scrollTop ?? 0;
    if (body) body.scrollTop = 0;
    const end = appHistory()?.step({ label, back: () => { closeNow(); return true; } });
    return () => {
      end?.();
      if (body) requestAnimationFrame(() => { body.scrollTop = was; });
    };
  }, [label]);
}
