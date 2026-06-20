"use client";

import { useEffect } from "react";

// Registers the offline-shell service worker. Push opt-in (OneSignal) is triggered
// later, after a couple of visits — not here (runbook Phase 6: "don't beg before
// there's a reason"). Disabled in dev to avoid stale-cache churn while editing.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
