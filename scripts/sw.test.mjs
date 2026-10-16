// THE APP THAT STOPPED UPDATING — public/sw.js, driven from its own file.
//
// On 2026-10-03 Ryan's installed app showed a panel that had been rewritten three weeks earlier,
// while production served the current build to every fresh browser. The service worker's
// "everything else is cache-first" branch had been caching Next's page data (the `?_rsc=` flight
// payloads the router fetches when a tab is tapped) since the day it installed, and nothing in
// the app could tell: the stale payload named chunk files that were still in the cache, so
// nothing failed and nothing healed. This runs the real worker in a sandbox with a fake cache and
// a fake network and asks it, request by request, what it does — and refuses the next edit to
// the file that forgets to bump the cache name, because an unbumped name is how three weeks of
// poisoned entries survived every deploy in between.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "public/sw.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const ORIGIN = "https://app.gt3pb.com";

// ── the recorded pair: this file's blob hash and the cache name it carries ─────────────────────
// Any change to sw.js reaches installed clients as a new worker; only a changed CACHE makes the
// activate step throw the old entries away. So an edit here must bump the name, and the pair below
// must be re-recorded with it (both values are printed when they differ).
const RECORDED = { sha: "944a4547684c97838a8646ed8f8506d8931d627a", cache: "gt3pb-v29" };
const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(SRC)}\0`).update(SRC).digest("hex");
const cacheName = (SRC.match(/const CACHE = "([^"]+)";/) || [])[1];
ok("sw: CACHE is declared once, as a plain string", !!cacheName && (SRC.match(/const CACHE = /g) || []).length === 1, cacheName);
if (blobSha !== RECORDED.sha && cacheName === RECORDED.cache) {
  ok(`sw: public/sw.js changed and CACHE did NOT — installed clients would keep every old entry. Bump CACHE past ${RECORDED.cache}, then record the pair here: { sha: "${blobSha}", cache: "<new name>" }`, false);
} else if (blobSha !== RECORDED.sha) {
  ok(`sw: public/sw.js changed and CACHE was bumped (${RECORDED.cache} → ${cacheName}) — record the new pair in scripts/sw.test.mjs: { sha: "${blobSha}", cache: "${cacheName}" }`, false);
} else {
  ok("sw: the recorded pair matches the file (sha and CACHE)", cacheName === RECORDED.cache, { cacheName, recorded: RECORDED.cache });
}

// ── a sandbox with a fake cache and a fake network ─────────────────────────────────────────────
function boot() {
  const listeners = {};
  const stores = new Map();              // cache name → Map(key → response)
  const keyOf = (r) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const openCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async put(req, res) { m.set(keyOf(req), res); },
      async match(req, opts) {
        const want = keyOf(req);
        if (m.has(want)) return m.get(want);
        if (opts && opts.ignoreSearch) { const u = new URL(want); u.search = ""; for (const [k, v] of m) { const ku = new URL(k); ku.search = ""; if (ku.href === u.href) return v; } }
        return undefined;
      },
      async addAll() { throw new Error("addAll is not used by this worker"); },
    };
  };
  const caches = {
    async open(name) { return openCache(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(req, opts) { for (const name of stores.keys()) { const r = await openCache(name).match(req, opts); if (r) return r; } return undefined; },
  };
  const net = { calls: [], answer: (req) => ({ ok: true, status: 200, redirected: false, body: `net:${typeof req === "string" ? req : req.url}`, clone() { return { ...this }; } }) };
  const fetch = async (req, init) => { net.calls.push({ url: typeof req === "string" ? req : req.url, init }); const a = net.answer(req, init); if (a instanceof Error) throw a; return a; };
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    location: { origin: ORIGIN },
    clients: { claimed: 0, claim() { this.claimed++; }, async matchAll() { return []; }, async openWindow() {} },
    skipWaiting() { self.skipped = true; },
    registration: { async showNotification() {} },
  };
  // A timer that fires on the next turn: the worker's waits are real waits, not this test's.
  const setTimeout = (fn) => { Promise.resolve().then(fn); return 0; };
  vm.runInNewContext(SRC, { self, caches, fetch, URL, Headers, console, Promise, setTimeout }, { filename: "public/sw.js" });
  const dispatch = async (type, event) => { listeners[type](event); if (event.responded) event.response = await event.responded; await Promise.all(event.waits); return event; };
  const fetchEvent = (request) => ({ request, responded: null, waits: [], respondWith(p) { this.responded = Promise.resolve(p); }, waitUntil(p) { this.waits.push(Promise.resolve(p).catch(() => {})); } });
  const req = (path, { mode = "cors", headers = {}, method = "GET", origin = ORIGIN } = {}) => ({ method, url: origin + path, mode, headers: new Headers(headers), redirect: mode === "navigate" ? "manual" : "follow" });
  return { listeners, stores, caches, net, self, dispatch, fetchEvent, req, cacheName };
}

// ── page data is never the worker's business ──────────────────────────────────────────────────
{
  const w = boot();
  const rsc = w.req("/crew?_rsc=1a2b3c", { headers: { RSC: "1" } });
  // the trap: a stale payload already sits in the cache, as it did on every installed phone
  (await w.caches.open(w.cacheName)).put(rsc, { body: "stale page data from August", clone() { return this; } });
  const ev = await w.dispatch("fetch", w.fetchEvent(rsc));
  ok("rsc: a router fetch (RSC: 1, ?_rsc=) is left to the browser — not answered from the cache, not cached", ev.responded === null && w.net.calls.length === 0);
  const prefetch = await w.dispatch("fetch", w.fetchEvent(w.req("/menu?_rsc=9z", { headers: { "Next-Router-Prefetch": "1" } })));
  ok("rsc: a prefetch is left to the browser too", prefetch.responded === null);
  const byQuery = await w.dispatch("fetch", w.fetchEvent(w.req("/menu?_rsc=9z")));
  ok("rsc: the ?_rsc= mark alone is enough", byQuery.responded === null);
  const api = await w.dispatch("fetch", w.fetchEvent(w.req("/api/menu")));
  ok("api: /api/ is left to the browser", api.responded === null);
  const cross = await w.dispatch("fetch", w.fetchEvent(w.req("/rest/v1/reserves", { origin: "https://hmpxgomiiyjjxxxyzzbg.supabase.co" })));
  ok("cross-origin: Supabase is left to the browser", cross.responded === null);
  const post = await w.dispatch("fetch", w.fetchEvent(w.req("/truck", { method: "POST", mode: "navigate" })));
  ok("method: anything but GET is left to the browser", post.responded === null);
}

// ── navigations: network-first, the cached shell when offline ─────────────────────────────────
{
  const w = boot();
  const nav = await w.dispatch("fetch", w.fetchEvent(w.req("/crew?s=prep", { mode: "navigate" })));
  // v28 (R10b): under its path alone — a query (an /order?t=… ticket that can cancel the order) is never a key on the device.
  ok("navigate: online, the network answers and the page is cached under its path alone — no query in the key",
    nav.response?.body === `net:${ORIGIN}/crew?s=prep` && (await w.caches.match(w.req("/crew", { mode: "navigate" })))?.body === `net:${ORIGIN}/crew?s=prep`
      && [...w.stores.get(w.cacheName).keys()].every((k) => !k.includes("?")));
  await w.dispatch("fetch", w.fetchEvent(w.req("/order?t=0b1e0000-0000-4000-8000-000000000001", { mode: "navigate" })));
  ok("navigate: a ticket's page is kept as /order, its ticket nowhere on the device", [...w.stores.get(w.cacheName).keys()].some((k) => k === `${ORIGIN}/order`)
    && ![...w.stores.get(w.cacheName).keys()].some((k) => k.includes("0b1e0000")));
  w.net.answer = () => ({ ok: false, status: 500, redirected: false, body: "broken", clone() { return this; } });
  await w.dispatch("fetch", w.fetchEvent(w.req("/menu", { mode: "navigate" })));
  ok("navigate: a 500 is handed back but never cached", (await w.caches.match(w.req("/menu", { mode: "navigate" }))) === undefined);
  w.net.answer = () => new Error("offline");
  const off = await w.dispatch("fetch", w.fetchEvent(w.req("/crew?s=money", { mode: "navigate" })));
  ok("navigate: offline, the cached shell answers for the same path whatever the query (ignoreSearch)", off.response?.body === `net:${ORIGIN}/crew?s=prep`);
  (await w.caches.open(w.cacheName)).put(w.req("/", { mode: "navigate" }), { body: "the root shell", clone() { return this; } });
  const unknown = await w.dispatch("fetch", w.fetchEvent(w.req("/never-opened", { mode: "navigate" })));
  ok("navigate: offline on a page never cached, the root shell answers rather than the dino", unknown.response?.body === "the root shell");
}

// ── /_next/static/: the only cache-first class ────────────────────────────────────────────────
{
  const w = boot();
  const chunk = w.req("/_next/static/chunks/abc123.js");
  const first = await w.dispatch("fetch", w.fetchEvent(chunk));
  ok("immutable: first request goes to the network and is cached", first.response?.body === `net:${ORIGIN}/_next/static/chunks/abc123.js` && (await w.caches.match(chunk))?.body === `net:${ORIGIN}/_next/static/chunks/abc123.js`);
  w.net.calls.length = 0;
  const second = await w.dispatch("fetch", w.fetchEvent(chunk));
  ok("immutable: the second request is answered from the cache without touching the network", second.response?.body === `net:${ORIGIN}/_next/static/chunks/abc123.js` && w.net.calls.length === 0);
  w.net.answer = () => ({ ok: false, status: 404, redirected: false, body: "gone", clone() { return this; } });
  const missing = w.req("/_next/static/chunks/old.js");
  await w.dispatch("fetch", w.fetchEvent(missing));
  ok("immutable: a 404 at a deploy boundary is never cached (the unstyled-app bug)", (await w.caches.match(missing)) === undefined);
}

// ── plain-named assets: cache for speed, refresh in the background, one load stale at most ─────
{
  const w = boot();
  const icon = w.req("/icon-192.png");
  const first = await w.dispatch("fetch", w.fetchEvent(icon));
  ok("asset: first request goes to the network and is cached", first.response?.body === `net:${ORIGIN}/icon-192.png` && (await w.caches.match(icon))?.body === `net:${ORIGIN}/icon-192.png`);
  w.net.answer = () => ({ ok: true, status: 200, redirected: false, body: "the NEW icon", clone() { return this; } });
  const second = await w.dispatch("fetch", w.fetchEvent(icon));
  ok("asset: the second request is answered from the cache at once…", second.response?.body === `net:${ORIGIN}/icon-192.png`);
  ok("asset: …and the network copy replaces the cached one behind it, so the next load is current", (await w.caches.match(icon))?.body === "the NEW icon");
  const third = await w.dispatch("fetch", w.fetchEvent(icon));
  ok("asset: the third request gets the new one — nothing is ever more than one load stale", third.response?.body === "the NEW icon");
  w.net.answer = () => new Error("offline");
  const off = await w.dispatch("fetch", w.fetchEvent(icon));
  ok("asset: offline, the cached copy still answers", off.response?.body === "the NEW icon");
}

// ── install and activate: the shell is fetched as nobody, and the old cache is purged ─────────
{
  const w = boot();
  w.net.answer = (req) => (String(req) === "/" ? { ok: true, status: 200, redirected: true, body: "/truck via the front door", clone() { return this; } } : { ok: true, status: 200, redirected: false, body: `net:${req}`, clone() { return this; } });
  const ev = { waits: [], waitUntil(p) { this.waits.push(p); } };
  w.listeners.install(ev); await Promise.all(ev.waits);
  ok("install: every shell URL is fetched without cookies, so the front door (proxy.ts) never redirects it", w.net.calls.length >= 9 && w.net.calls.every((c) => c.init?.credentials === "omit"));
  ok("install: a redirected answer is not stored — a navigation can never be served one", (await w.caches.match("/")) === undefined && (await w.caches.match("/truck"))?.body === "net:/truck");
  const old = await w.caches.open("gt3pb-v25");
  await old.put(w.req("/crew?_rsc=1", { headers: { RSC: "1" } }), { body: "poison", clone() { return this; } });
  const act = { waits: [], waitUntil(p) { this.waits.push(p); } };
  w.listeners.activate(act); await Promise.all(act.waits);
  ok("activate: every cache but the current one is deleted — the poisoned entries go with it", !(await w.caches.keys()).includes("gt3pb-v25") && (await w.caches.keys()).includes(w.cacheName));
  ok("activate: the worker claims open clients", w.self.clients.claimed === 1);
}

// ── the push handler (2026-10-11, wave 2 · alerts): one notification per event, and what rings over an open app ──
// Until now nothing ran the push handler. Every push shared the tag "gt3pb", so a second order or an escalation
// replaced the notification still showing without a sound; and every push was dropped while the app was on screen,
// though an alert has no toast or chime in the app. Driven here with the payloads the push function sends.
{
  const pushEvent = (payload) => ({ data: payload === undefined ? null : { json: () => JSON.parse(typeof payload === "string" ? payload : JSON.stringify(payload)), text: () => String(payload) }, waits: [], waitUntil(p) { this.waits.push(Promise.resolve(p)); } });
  const run = async (payload, windows = []) => {
    const w = boot();
    const shown = [];
    w.self.registration.showNotification = async (title, opts) => { shown.push({ title, ...opts }); };
    w.self.clients.matchAll = async () => windows;
    const ev = pushEvent(payload);
    w.listeners.push(ev);
    await Promise.all(ev.waits);
    return shown;
  };
  const hidden = [{ focused: false, visibilityState: "hidden" }], open = [{ focused: true, visibilityState: "visible" }];

  const a = await run({ title: "New order", body: "2 items · tap to open", url: "/crew?s=now&a=kitchen-pass", tag: "order:o-1", ring: false }, hidden);
  ok("push: the app in a pocket shows the push as sent — its title, its body, its own tag, the link a tap opens",
    a.length === 1 && a[0].title === "New order" && a[0].body === "2 items · tap to open" && a[0].tag === "order:o-1" && a[0].data.url === "/crew?s=now&a=kitchen-pass", a);
  const two = [...(await run({ title: "New order", body: "1 item · tap to open", tag: "order:o-1" }, hidden)), ...(await run({ title: "New order", body: "1 item · tap to open", tag: "order:o-2" }, hidden))];
  ok("push: two orders are two notifications — two tags, neither replacing the other", two.length === 2 && two[0].tag !== two[1].tag);
  ok("push: an order is not shown over an open app — the Pass chimes for its own (unchanged)",
    (await run({ title: "New order", body: "x", tag: "order:o-3", ring: false }, open)).length === 0);
  const crit = await run({ title: "Critical — A refund is needed", body: "Tap to open.", url: "/crew?s=money", tag: "alert:a-1", ring: true }, open);
  ok("push: a critical rings over an open app — nothing in the app sounds for an alert", crit.length === 1 && crit[0].tag === "alert:a-1", crit);
  const again = await run({ title: "Still open — A refund is needed", body: "x", tag: "alert:a-1:again", ring: true }, open);
  ok("push: an escalation is shown with a tag of its own, so it rings beside the first rather than replacing it", again.length === 1 && again[0].tag === "alert:a-1:again");
  const test = await run({ title: "Test alert", body: "Alerts reach this phone. Nothing to do.", tag: "test:d-1", ring: true }, open);
  ok("push: \"Ring this phone\" rings with the settings screen open in front of the person who asked", test.length === 1 && test[0].title === "Test alert");
  const old = await run({ title: "Old function", body: "no tag here", url: "/" }, hidden);
  ok("push: a payload from a push function deployed before this keeps the old tag and the old rule", old.length === 1 && old[0].tag === "gt3pb"
    && (await run({ title: "Old function", body: "x" }, open)).length === 0);
  ok("push: an empty push shows nothing", (await run(undefined, hidden)).length === 0);

  // SHOWN ANYWAY WHERE WEBKIT IS THE BROWSER (R11): an iPhone web app or Safari that gets pushes and shows nothing loses its
  // subscription — so there an order over the open app is shown without a sound, and taken down again.
  const onBrowser = async (ua, payload, windows) => {
    const w = boot();
    const shown = [], closed = [];
    w.self.navigator = { userAgent: ua };
    w.self.registration.showNotification = async (title, opts) => { shown.push({ title, ...opts }); };
    w.self.registration.getNotifications = async ({ tag }) => shown.filter((n) => n.tag === tag).map((n) => ({ close: () => closed.push(n.tag) }));
    w.self.clients.matchAll = async () => windows;
    const ev = pushEvent(payload);
    w.listeners.push(ev);
    await Promise.all(ev.waits);
    return { shown, closed };
  };
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const order = { title: "New order", body: "x", url: "/crew?s=now", tag: "order:o-9", ring: false };
  const iph = await onBrowser(IPHONE, order, open);
  ok("push (WebKit): an order over the open iPhone web app is shown — silent, under its own tag — and taken down again",
    iph.shown.length === 1 && iph.shown[0].silent === true && iph.shown[0].tag === "order:o-9" && iph.closed.join() === "order:o-9", iph);
  ok("push (WebKit): Safari on a Mac too", (await onBrowser(SAFARI, order, open)).shown.length === 1);
  const chr = await onBrowser(CHROME, order, open);
  ok("push (Chrome): an order over the open app is still not shown — Chrome lets a page say it itself", chr.shown.length === 0 && chr.closed.length === 0);
  const pocket = await onBrowser(IPHONE, order, hidden);
  ok("push (WebKit): in a pocket it is shown as ever — with its sound, and left up", pocket.shown.length === 1 && pocket.shown[0].silent === undefined && pocket.closed.length === 0, pocket);
  const ring = await onBrowser(IPHONE, { ...order, tag: "alert:a-9", ring: true }, open);
  ok("push (WebKit): what rings over an open app still rings, and stays", ring.shown.length === 1 && ring.shown[0].silent === undefined && ring.closed.length === 0);
  const text = await run("not json at all", hidden);
  ok("push: a payload that is not JSON is shown as text under the brand", text.length === 1 && text[0].title === "GT3PB" && text[0].body === "not json at all", text);
}

// ── ONE WINDOW (R11): a tapped notification brings the app's window forward and sends it to the link ──
{
  const click = async (url, windows) => {
    const w = boot();
    const opened = [];
    w.self.clients.matchAll = async () => windows;
    w.self.clients.openWindow = async (u) => { opened.push(u); };
    const ev = { notification: { data: { url }, close() { this.closed = true; } }, waits: [], waitUntil(p) { this.waits.push(Promise.resolve(p)); } };
    w.listeners.notificationclick(ev);
    await Promise.all(ev.waits);
    return { opened, closed: ev.notification.closed === true };
  };
  const win = (over = {}) => {
    const c = { url: `${ORIGIN}/menu`, focused: false, visibilityState: "visible", focusedBy: 0, went: [], told: [],
      async focus() { this.focusedBy++; return this; }, async navigate(u) { this.went.push(u); return this; }, postMessage(m) { this.told.push(m); }, ...over };
    return c;
  };
  const one = win();
  const r1 = await click("/crew?s=now&a=kitchen-pass", [one]);
  ok("click: the open window is brought forward and sent to the link — no second window",
    r1.closed && r1.opened.length === 0 && one.focusedBy === 1 && one.went.join() === `${ORIGIN}/crew?s=now&a=kitchen-pass`, { r1, one });
  const r2 = await click("/crew?s=now", []);
  ok("click: with no window open, one is opened at the link", r2.opened.join() === `${ORIGIN}/crew?s=now`, r2);
  const there = win({ url: `${ORIGIN}/crew?s=now` });
  await click("/crew?s=now", [there]);
  ok("click: a window already at the link is only brought forward", there.focusedBy === 1 && there.went.length === 0 && there.told.length === 0);
  const loose = win({ navigate: undefined });
  await click("/office", [loose]);
  ok("click: a window this worker can't steer is told to go there itself (components/ServiceWorkerRegister)",
    loose.focusedBy === 1 && loose.told.length === 1 && loose.told[0].type === "gt3-open" && loose.told[0].url === `${ORIGIN}/office`, loose.told);
  const back = win({ visibilityState: "hidden" }), front = win({ focused: true });
  await click("/menu?x=1", [back, front]);
  ok("click: of two windows, the one in front is the one used", front.focusedBy === 1 && back.focusedBy === 0);
}

console.log(`THE APP THAT STOPPED UPDATING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
