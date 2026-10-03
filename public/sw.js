/* GT3PB service worker — offline shell + asset cache (runbook Phase 6).
   Native Web Push (VAPID) handlers below; opt-in happens after a couple visits.
   Bump CACHE on any shell/icon change so installed clients refresh cleanly. */
// v25 (2026-07-29, field round): +/crew +/driver in the shell — the two screens the crew actually
// stands in a field with. With the console now code-split, each section's chunk is runtime-cached
// (cache-first below) the first time it's opened, so the sections you use daily become available
// offline BY use; never-opened sections need one online visit first.
//
// v26 (2026-10-03): THE APP THAT STOPPED UPDATING. Ryan's phone showed the Ask GT3 panel with
// every asterisk visible and five full-sentence chips — code that was replaced on Sept 12 and 13.
// Production was serving the current build to every fresh browser; his installed app was not
// running it. The fetch handler below had two branches: navigations (network-first) and
// "everything else" (cache-first, meant for fonts, images, css, js). Next's app router does not
// navigate when you tap a tab — it fetches the page's data as a same-origin GET with an `RSC: 1`
// header and a `?_rsc=` query, content-type text/x-component. That is "everything else". So the
// FIRST time a route was opened after this worker installed, its data was cached, and every
// client-side visit since has been served that day's page from the cache, forever: the flight
// data names the chunk files of the build it came from, those are content-hashed and cached too,
// and nothing fails, so nothing heals — lib/deploySkew.ts only ever sees a chunk that will not
// load. The cache name had not changed since July 29, so the entries were never purged either.
//
// The policy is now one rule per class, and the class a request belongs to is decided first:
//   browser   — not GET, cross-origin, /api/, and page DATA (RSC) — never touched by this worker
//   navigate  — network-first, cached shell when offline (unchanged)
//   immutable — /_next/static/: content-hashed by the build, cache-first (unchanged, now the ONLY
//               thing that is cache-first)
//   asset     — everything else same-origin (icons, brand images, fonts, the manifest): served from
//               cache when present for speed on a truck's network, and refreshed from the network
//               in the background every time, so a changed icon is one load stale and never more
// Bumping the name purges every install's poisoned data entries on activation. The whole handler
// is driven from its own file by scripts/sw.test.mjs — the RSC case, the navigation case, the
// immutable case, the asset case and the purge — and that test refuses a future edit to this
// file that does not bump the name again.
const CACHE = "gt3pb-v26";
const SHELL = ["/", "/truck", "/menu", "/events", "/3mpire", "/book", "/crew", "/driver", "/manifest.webmanifest"];

// Page DATA, not a page: Next's router fetches a route's flight payload with these marks whenever
// a tab is tapped or a link is prefetched. It is as dynamic as /api/ and is treated the same way.
const isPageData = (request, url) =>
  request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1" || url.searchParams.has("_rsc");

self.addEventListener("install", (event) => {
  // Don't auto-activate: a new build waits until the user taps "Update" (SKIP_WAITING),
  // so we never swap assets mid-tap and the client can show an "update ready" prompt.
  // credentials:"omit" on purpose — proxy.ts sends a request to "/" that carries a guest cookie to
  // /truck, and a redirected response stored under "/" can never be served to a navigation (the
  // browser refuses it): the shell must be the page itself, so it is fetched as nobody.
  event.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(SHELL.map((u) => fetch(u, { credentials: "omit" }).then((res) => { if (res.ok && !res.redirected) return c.put(u, res); })))
  ).catch(() => {}));
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
  // (Supabase REST/Realtime, etc.) + the router's own page data (see v26 above). Go straight to
  // the network so the app always sees fresh data. A cache-first SW here is what served stale
  // /api/assets + event_approvals responses — and then, for three weeks, stale pages.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || isPageData(request, url)) return;

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
        // ignoreSearch: the crew console navigates as /crew?s=prep — the query must not miss the
        // cached /crew shell, or offline opens the dino page while the shell sits in cache.
        .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Cache-first ONLY for what the build content-hashed: a file under /_next/static/ never changes
  // under its name, so the cache can never be wrong about it.
  if (url.pathname.startsWith("/_next/static/")) {
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
    return;
  }

  // Everything else this origin serves under a plain name — icons, brand images, fonts, the
  // manifest: answer from the cache when there is one (a truck's network is not to be waited on),
  // and refresh that entry from the network in the background on every request, so the next load
  // has what the server has now. Nothing is ever more than one load stale.
  const refresh = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) { event.waitUntil(refresh.catch(() => {})); return cached; }
    return refresh;
  }));
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
      data: { url: data.url || "/" },
    });
  })());
});

// Deep-link: a push that carries a url (e.g. an order alert pointing at the pass) opens THERE,
// not the home page (v25 — was hardcoded "/").
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/"));
});
