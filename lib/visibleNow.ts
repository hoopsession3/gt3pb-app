"use client";

import { useSyncExternalStore } from "react";

// THE TIME THE SCREEN WAS LAST LOOKED AT (R7b, 2026-10-16). Today's greeting and date are read when the page opens and
// again whenever the app comes back to the front: an app left open overnight said "Evening" and yesterday's date the
// next morning. Read through useSyncExternalStore rather than copied into state by an effect — the server draws no time
// (null, so the first paint matches it), the phone draws the time the screen was opened or last shown.
let stamp: Date | null = null;
const listeners = new Set<() => void>();

const STALE_MS = 60_000;
const fresh = () => { if (!stamp || Date.now() - stamp.getTime() > STALE_MS) stamp = new Date(); };

function onVisible() {
  if (document.visibilityState !== "visible") return;
  stamp = new Date();
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) document.addEventListener("visibilitychange", onVisible);
  // A screen opened again later reads the time it opened at; React reads the snapshot again once it has subscribed.
  fresh();
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) document.removeEventListener("visibilitychange", onVisible);
  };
}

const snapshot = (): Date => { if (!stamp) stamp = new Date(); return stamp; };
const onServer = (): Date | null => null;

export function useVisibleNow(): Date | null {
  return useSyncExternalStore(subscribe, snapshot, onServer);
}
