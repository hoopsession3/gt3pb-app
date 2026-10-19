"use client";

import { useEffect, useState } from "react";
import { APP_BUILD } from "@/lib/native";

// Registers the offline-shell service worker AND surfaces a controlled "update ready"
// prompt: when a new build deploys, the new worker installs and waits; we show a
// tap-to-refresh banner instead of silently serving a stale app (the cause of the
// "where are my changes?" confusion). Push opt-in happens elsewhere. Disabled in dev.
export default function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    // Not in the iPhone app (2026-10-06): its screens are bundled in the app, a new version arrives
    // as an app update, and a page served from capacitor://localhost cannot register a worker.
    if (APP_BUILD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | undefined;
    let alive = true;

    // AFTER THE PAGE, NOT DURING IT (R38 — the fresh audit's PERF11-07). Registering on the first page's mount put the
    // worker's download and its install — every shell page fetched — inside that page's own first seconds. It waits for
    // the page's load now, then for a quiet moment (a second at most).
    const register = () => navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => {
        if (!alive) return;
        reg = r;
        // A subscription the push service rotated while the app was closed is kept again (R35 — FE11-12, lib/push).
        void import("@/lib/push").then((m) => m.rekeepPush()).catch(() => {});
        // An update may already be waiting from a deploy while the app was closed.
        if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
        r.addEventListener("updatefound", () => {
          const nw = r.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            // Only prompt on an *update* (a controller already exists), not first install.
            if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch(() => {});
    const idle = (fn: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1000 }); else setTimeout(fn, 200);
    };
    const onLoad = () => idle(() => { if (alive) void register(); });
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });

    // Re-check for a new build when the app returns to the foreground.
    const onFocus = () => reg?.update().catch(() => {});
    window.addEventListener("focus", onFocus);

    // When a NEW worker takes control, reload once to pull the fresh assets.
    //
    // Not on the first one (2026-10-04). public/sw.js claims open pages when it activates, and on a
    // first visit there is no worker yet, so it activates at once and the claim fires
    // controllerchange here too — which reloaded every guest's first page half a second in. Traced
    // on the customer side: "/" → /truck → a second document of /truck, the menu reloading under the
    // thumb of someone who had just scanned the truck's code. The page a first visit has IS the
    // current build; there is nothing fresher to pull. Only a worker replacing a worker reloads —
    // the update this was written for, the same line the install prompt above already draws.
    let refreshing = false;
    let hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (!hadController) { hadController = true; return; }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Sent to a link by a tapped notification (public/sw.js, ONE WINDOW — R11): the worker brings this window forward and
    // steers it there itself when it controls it; one it doesn't control is told to go, and goes — on this site only.
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; url?: unknown } | null;
      // The worker renewed this browser's push subscription (public/sw.js pushsubscriptionchange): keep the new one.
      if (d?.type === "gt3-push-renewed") { void import("@/lib/push").then((m) => m.rekeepPush(true)).catch(() => {}); return; }
      if (d?.type !== "gt3-open" || typeof d.url !== "string") return;
      try {
        const here = new URL(window.location.href), to = new URL(d.url, here);
        if (to.origin === here.origin && to.href !== here.href) window.location.assign(to.href);
      } catch { /* not a link */ }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      alive = false;
      window.removeEventListener("load", onLoad);
      window.removeEventListener("focus", onFocus);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  if (!waiting) return null;

  const update = () => {
    waiting.postMessage({ type: "SKIP_WAITING" }); // → controllerchange → reload
    setWaiting(null);
  };

  return (
    <button className="sw-update" onClick={update} aria-label="A new version is ready — tap to refresh">
      <span className="sw-update-dot" />
      New version ready · tap to refresh
    </button>
  );
}
