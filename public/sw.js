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
//
// v27 (2026-10-11, wave 2 · alerts): only the push handler changed — a push names its event (one
// notification each, so a second order or an escalation rings instead of silently replacing the
// first) and a critical, an escalation or a person's own test is shown with the app open too. The
// name is bumped because the rule above says every edit bumps it.
//
// v28 (2026-10-16, R10b · the 10/10 audit): a page is kept under its path alone — an /order?t=… ticket, which can cancel
// the order, was a cache key on the device. Nothing else changed.
// v30 (2026-10-18, R35 · the fresh audit's FE11-13 and FE11-12): a navigation waits on the network NAV_DEADLINE_MS, not
// for ever — on one stalled bar at a market the installed app sat on a white screen for tens of seconds with its page in
// the cache. Past the deadline the cached page answers, and the fetch, still under way, refreshes the cache for the next
// load; with nothing cached it goes on waiting. And a subscription the push service renews is kept again
// (pushsubscriptionchange, below).
// v31 (2026-10-19, R38 · the fresh audit's PERF11-07): a navigation no longer waits for the worker to start before it
// asks the network — navigation preload starts the page's fetch beside the worker's own start, and the worker answers
// with that response (the deadline above stands). And the fonts, served from the cache with no fetch behind them on every
// page: a font changes only with a new worker, whose name sweeps it away. Nothing else changed.
const CACHE = "gt3pb-v31";
const NAV_DEADLINE_MS = 3500;
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
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    // v31: the page's fetch starts beside the worker's own start (a browser without it answers nothing here).
    Promise.resolve(self.registration.navigationPreload && self.registration.navigationPreload.enable()).catch(() => {}),
  ]));
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

  // Network-first for navigations (fresh content) — for NAV_DEADLINE_MS (v30); then, or offline, the cached shell.
  if (request.mode === "navigate") {
    let kept = Promise.resolve();
    // v31: the preloaded response when the browser started one; else the worker asks itself.
    const asked = Promise.resolve(event.preloadResponse).then((pre) => pre || fetch(request), () => fetch(request));
    const network = asked.then((res) => {
      // Only cache good responses — caching a 404/500 shell would serve a broken page offline.
      // Kept under its path alone (v28, R10b — the 10/10 audit): /order?t=… is a ticket that can cancel an order, and a
      // query in a cache key is kept on the device. Offline asks with ignoreSearch below, so the shell is found as before.
      if (res.ok) {
        const copy = res.clone();
        kept = caches.open(CACHE).then((c) => c.put(url.origin + url.pathname, copy));
      }
      return res;
    });
    // ignoreSearch: the crew console navigates as /crew?s=prep — the query must not miss the
    // cached /crew shell, or offline opens the dino page while the shell sits in cache.
    const cached = () => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match("/"));
    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const answer = (r) => { if (!settled) { settled = true; resolve(r); } };
      // Past the deadline the cached page answers — when there is one; with none, the network is still the only answer.
      const timer = setTimeout(() => { cached().then((r) => { if (r) answer(r); }, () => {}); }, NAV_DEADLINE_MS);
      network.then((res) => { clearTimeout(timer); answer(res); },
        () => { clearTimeout(timer); cached().then((r) => answer(r || Response.error()), () => answer(Response.error())); });
    }));
    // The fetch finishes either way, and refreshes the cached page for the next load.
    event.waitUntil(network.then(() => kept).catch(() => {}));
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

  // v31: the fonts — cache-first like the build's own files, with no fetch behind them on every page. A font is replaced
  // only with a new worker (every edit here bumps CACHE), whose activation sweeps the old one away.
  if (url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return res;
      }))
    );
    return;
  }

  // Everything else this origin serves under a plain name — icons, brand images, the
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
// SHOWN ANYWAY WHERE WEBKIT IS THE BROWSER (R11, 2026-10-16 — the 10/10 audit). A push that arrives while the app is on
// screen was dropped (the app toasts and chimes for its own), and Chrome lets a page do that. WebKit does not: an iPhone
// home-screen web app, or Safari, that receives pushes and shows nothing has its subscription revoked after a few — so a
// web Pass on an iPad, or a member with the app open while an order is made, quietly stopped getting pushes at all.
// There it is shown without a sound, and taken down again after QUIET_MS; the app has already said it.
const QUIET_MS = 4000;
function webkitOnly() {
  const ua = (self.navigator && self.navigator.userAgent) || "";
  return /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Edg\/|OPR\/|Android/.test(ua));
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "GT3PB", body: event.data.text() }; }
  event.waitUntil((async () => {
    // If a window is open + focused, the in-app toast already shows this — don't
    // double it with an OS banner. This is what kept stacking duplicate notifications.
    // EXCEPT WHAT THE APP DOES NOT SOUND FOR (2026-10-11): an alert has no toast and no chime in the
    // app — the inbox just reloads — so a critical, an escalation and a person's own "Ring this phone"
    // test come with `ring` and are shown over an open app as well (supabase/functions/push/policy.ts).
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const onScreen = wins.some((c) => c.focused || c.visibilityState === "visible");
    if (!data.ring && onScreen && !webkitOnly()) return;
    const quiet = !data.ring && onScreen;
    // ONE NOTIFICATION PER EVENT (2026-10-11). Every push shared the tag "gt3pb", so a second order or
    // alert replaced the one still showing, without a sound — and an escalation, sent because the first
    // went unanswered and so was likely still showing, was the quietest of all. The push function names
    // each event now; a push from a function deployed before that keeps the old tag.
    const tag = typeof data.tag === "string" && data.tag ? data.tag : "gt3pb";
    await self.registration.showNotification(data.title || "GT3PB", {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      ...(quiet ? { silent: true } : {}),
      data: { url: data.url || "/" },
    });
    if (!quiet) return;
    await new Promise((r) => setTimeout(r, QUIET_MS));
    const up = self.registration.getNotifications ? await self.registration.getNotifications({ tag }) : [];
    for (const n of up) n.close();
  })());
});

// ONE WINDOW (R11, 2026-10-16 — the 10/10 audit). A tap on a notification always opened a new window — on a computer or
// an Android phone, each tapped order was another whole console, with its own feed, its own wake lock and, on the Pass,
// its own chime for every order. The app's window is brought forward and sent to the link; a new one only when none is
// open. A window this worker does not control can't be sent anywhere by it, and is told to go itself
// (components/ServiceWorkerRegister).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((c) => c.focused) || wins.find((c) => c.visibilityState === "visible") || wins[0];
    if (!win) { await self.clients.openWindow(url); return; }
    try { if (win.focus) await win.focus(); } catch { /* focus is the browser's to refuse */ }
    if (win.url === url) return;
    try { if (win.navigate) { await win.navigate(url); return; } } catch { /* not this worker's window */ }
    win.postMessage({ type: "gt3-open", url });
  })());
});

// A SUBSCRIPTION THE PUSH SERVICE RENEWED IS KEPT AGAIN (v30, R35 — the fresh audit's FE11-12). A push service that
// rotates or expires a subscription says so here; unanswered, the kept endpoint was dead and the Pass's new-order pushes
// stopped, unsaid, until someone opened Notifications and saw "Turn on" again. The worker subscribes again with the old
// options when the browser hasn't, and tells every open window, which keeps the new one (components/ServiceWorkerRegister
// → lib/push rekeepPush). A window opened later keeps it on load: its endpoint isn't the one last kept.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    let sub = event.newSubscription || null;
    const old = event.oldSubscription;
    if (!sub && old && old.options) {
      try { sub = await self.registration.pushManager.subscribe(old.options); } catch { sub = null; }
    }
    if (!sub) return;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) w.postMessage({ type: "gt3-push-renewed" });
  })());
});
