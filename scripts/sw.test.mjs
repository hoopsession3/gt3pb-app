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
const RECORDED = { sha: "e302bb623a90a41275d3e1e76fac076f673f6bf1", cache: "gt3pb-v26" };
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
  vm.runInNewContext(SRC, { self, caches, fetch, URL, Headers, console, Promise }, { filename: "public/sw.js" });
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
  ok("navigate: online, the network answers and the page is cached under its own URL", nav.response?.body === `net:${ORIGIN}/crew?s=prep` && (await w.caches.match(w.req("/crew?s=prep", { mode: "navigate" })))?.body === `net:${ORIGIN}/crew?s=prep`);
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

console.log(`THE APP THAT STOPPED UPDATING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
