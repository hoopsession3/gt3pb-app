"use client";

import { useEffect, useState } from "react";

// Registers the offline-shell service worker AND surfaces a controlled "update ready"
// prompt: when a new build deploys, the new worker installs and waits; we show a
// tap-to-refresh banner instead of silently serving a stale app (the cause of the
// "where are my changes?" confusion). Push opt-in happens elsewhere. Disabled in dev.
export default function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => {
        reg = r;
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

    // Re-check for a new build when the app returns to the foreground.
    const onFocus = () => reg?.update().catch(() => {});
    window.addEventListener("focus", onFocus);

    // When the new worker takes control, reload once to pull the fresh assets.
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
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
