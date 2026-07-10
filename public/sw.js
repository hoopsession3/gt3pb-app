/* GT3PB service worker — offline shell + asset cache (runbook Phase 6).
   Native Web Push (VAPID) handlers below; opt-in happens after a couple visits.
   Bump CACHE on any shell/icon change so installed clients refresh cleanly. */
const CACHE = "gt3pb-v24"; // v24: never cache non-ok responses (a cached 404 CSS = unstyled app forever)
const SHELL = ["/", "/truck", "/menu", "/events", "/3mpire", "/book", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // Don't auto-activate: a new build waits until the user taps "Update" (SKIP_WAITING),
  // so we never swap assets mid-tap and the client can show an "update ready" prompt.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

// The page asks the waiting worker to take over (controlled, user-initiated update).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Dynamic data must NEVER come from cache: our /api/ routes + any cross-origin request
  // (Supabase REST/Realtime, etc.). Go straight to the network so the app always sees fresh
  // data. A cache-first SW here is what served stale /api/assets + event_approvals responses
  // — the network was never hit, so cache:no-store and even RLS/DB fixes couldn't surface.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Network-first for navigations (fresh content), fall back to cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache good responses — caching a 404/500 shell would serve a broken page offline.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Cache-first for static assets (fonts, images, css, js).
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          // res.ok guard: a transient 404 on a fingerprinted css/js (deploy boundary) must never
          // be cached — cache-first would then serve the 404 forever = the "unstyled app" bug.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});

/* ---- Native Web Push (VAPID) ---- */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "GT3PB", body: event.data.text() }; }
  event.waitUntil((async () => {
    // If a window is open + focused, the in-app toast already shows this — don't
    // double it with an OS banner. This is what kept stacking duplicate notifications.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((c) => c.focused || c.visibilityState === "visible")) return;
    await self.registration.showNotification(data.title || "GT3PB", {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag: "gt3pb",
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
