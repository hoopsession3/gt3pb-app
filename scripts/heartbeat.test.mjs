// WHO IS WATCHING THE PASS (2026-10-11) — the page's half, run.
//
//   1. lib/heartbeat, compiled from its TypeScript (scripts/fixtures/chargeonce.mjs libLoader): what the Pass's feed
//      event means, the device's id, the build and alerts a beat names, when a beat goes (a fake clock), what
//      crew_heartbeat is sent — held to 0375's own parameter names and feed words, read from the migration — and the
//      words the Devices card shows.
//   2. components/usePassHeartbeat, the hook AdminPage mounts, and lib/useWakeLock, compiled and run on just enough of
//      React to call a hook the way a component does (state, refs, effects with their deps and cleanups in order,
//      useSyncExternalStore's subscribe), with a fake window, document, clock and Supabase client. What is real is
//      the code under test; what is stood in for is named where it is made.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const tick = () => new Promise((r) => setImmediate(r));

const H = libLoader()("lib/heartbeat.ts");
ok("compiled: lib/heartbeat", typeof H.beater === "function" && typeof H.deviceView === "function");
const sql375 = readFileSync(join(ROOT, "supabase/migrations/0375_a_device_on_the_pass_checks_in_every_minute.sql"), "utf8");
const sql376 = readFileSync(join(ROOT, "supabase/migrations/0376_nobody_on_the_pass_during_service_is_an_alert.sql"), "utf8");

// ── the Pass's word on its feed ──────────────────────────────────────────────────────────────────────────────────────
ok("the event is gt3:pass-feed", H.PASS_FEED_EVENT === "gt3:pass-feed");
ok("each of the five words passes through as said",
  ["live", "reconnecting", "down", "signed-out", "unknown"].every((s) => H.feedOf({ state: s, at: 1 }) === s));
ok("anything not said plainly is unknown — a capital, a word it does not know, no state, no detail, a bare string",
  [{ state: "LIVE" }, { state: "up" }, {}, null, undefined, "live", { state: 1 }].every((d) => H.feedOf(d) === "unknown"));
const feedCheck = /feed\s+text not null default 'unknown' check \(feed in \(([^)]*)\)\)/.exec(sql375);
ok("known pair: the five words are 0375's own (device_heartbeats.feed's check)",
  !!feedCheck && feedCheck[1].split(",").map((s) => s.trim().replace(/'/g, "")).join() === H.FEEDS.join(), feedCheck?.[1]);
{
  const win = new EventTarget();
  let told = 0;
  const off = H.onPassFeed(() => { told++; });
  ok("before the Pass says anything, its feed is unknown", H.passFeed() === "unknown");
  const stop = H.hearPassFeed(win);
  win.dispatchEvent(new CustomEvent(H.PASS_FEED_EVENT, { detail: { state: "live", at: Date.now() } }));
  ok("heard on the window: the Pass says live, the feed is live, and whoever watches is told", H.passFeed() === "live" && told === 1, { feed: H.passFeed(), told });
  win.dispatchEvent(new CustomEvent(H.PASS_FEED_EVENT, { detail: { state: "live", at: Date.now() } }));
  ok("…the same word again tells nobody", told === 1);
  win.dispatchEvent(new CustomEvent(H.PASS_FEED_EVENT, { detail: { state: "nonsense" } }));
  ok("…a word it does not know is unknown, not kept as live", H.passFeed() === "unknown" && told === 2);
  stop();
  win.dispatchEvent(new CustomEvent(H.PASS_FEED_EVENT, { detail: { state: "down" } }));
  ok("stopped hearing: a later word changes nothing", H.passFeed() === "unknown");
  off();
  H.setPassFeed("down");
  ok("…and a watcher that left is not told", told === 2 && H.passFeed() === "down");
  H.setPassFeed("unknown");
}

// ── the build, the app, alerts ───────────────────────────────────────────────────────────────────────────────────────
{
  let told = 0;
  const off = H.onAppBuild(() => { told++; });
  H.setAppBuild("  1.0 (42)  ");
  H.setAppBuild("1.0 (42)");
  ok("the app's build is kept trimmed, and saying it twice tells once", H.appBuild() === "1.0 (42)" && told === 1, { b: H.appBuild(), told });
  H.setAppBuild("9".repeat(60));
  ok("…and kept to 0375's 40 characters", H.appBuild()?.length === 40);
  H.setAppBuild(null); off();
  ok("the iPhone app is 'ios' only inside its shell, on iOS; a browser, a home-screen web app or a test run is 'web'",
    H.appOf(true, "ios") === "ios" && H.appOf(true, "android") === "web" && H.appOf(false, "ios") === "web" && H.appOf(false, "web") === "web");
  ok("the web names its commit in seven characters, or no build at all when it does not know it",
    H.buildOf("web", "0c040e6f00ba", null) === "0c040e6" && H.buildOf("web", "", "1.0 (42)") === null && H.buildOf("web", undefined, null) === null);
  ok("the app names its own version and build, or none until the phone has said",
    H.buildOf("ios", "0c040e6f00ba", "1.0 (42)") === "1.0 (42)" && H.buildOf("ios", "0c040e6f00ba", null) === null);
  ok("alerts on, as Live Ops' alerts-off line reads them: the web's yes, and only a yes",
    H.alertsOnFrom({ app: false, nativePushOn: false, web: "granted", native: "unknown" }) === true
    && ["default", "denied", "unsupported", "unknown"].every((w) => H.alertsOnFrom({ app: false, nativePushOn: true, web: w, native: "granted" }) === false));
  ok("…in the app: only while the app's alerts are live and iOS said yes",
    H.alertsOnFrom({ app: true, nativePushOn: true, web: "granted", native: "granted" }) === true
    && H.alertsOnFrom({ app: true, nativePushOn: false, web: "granted", native: "granted" }) === false
    && ["prompt", "denied", "unavailable", "unknown"].every((n) => H.alertsOnFrom({ app: true, nativePushOn: true, web: "granted", native: n }) === false));
}

// ── this device ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = new Set(Array.from({ length: 200 }, () => H.mintId()));
  ok("a minted id is a v4 uuid, and two hundred of them are two hundred", ids.size === 200 && [...ids].every((x) => UUID.test(x)));
  ok("…made from the random bytes it is given", H.mintId((b) => b.fill(0)) === "00000000-0000-4000-8000-000000000000");
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m }; };
  const s = store();
  let minted = 0;
  const mint = () => { minted++; return H.mintId(); };
  const first = H.deviceId(s, mint);
  ok("a first visit mints an id and keeps it in localStorage", minted === 1 && s.m.get(H.DEVICE_KEY) === first && UUID.test(first));
  ok("…every visit after reads it back, minting nothing", H.deviceId(s, mint) === first && H.deviceId(s, mint) === first && minted === 1);
  const junk = store(); junk.setItem(H.DEVICE_KEY, "not an id!");
  const fixed = H.deviceId(junk, mint);
  ok("a kept value that is not an id (0375 would refuse it) is replaced", fixed !== "not an id!" && junk.m.get(H.DEVICE_KEY) === fixed);
  const locked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  const v1 = H.deviceId(locked, mint), v2 = H.deviceId(locked, mint), v3 = H.deviceId(null, mint);
  ok("storage that cannot be read or written: one id for this visit, the same every time", v1 === v2 && v2 === v3 && /^[A-Za-z0-9-]{8,64}$/.test(v1), { v1, v2, v3 });
  const devCheck = /device_id\s+text not null check \(device_id ~ '([^']+)'\)/.exec(sql375);
  ok("known pair: a minted id passes 0375's own device_id check", !!devCheck && new RegExp(devCheck[1]).test(H.mintId()), devCheck?.[1]);
}

// ── what crew_heartbeat is sent ──────────────────────────────────────────────────────────────────────────────────────
{
  const b = { device: "7d1e0c2a-5b6f-4c8d-9e0f-1a2b3c4d5e6f", surface: H.PASS_SURFACE, app: "web", build: "0c040e6", feed: "live", alertsOn: true, wakeLock: false };
  const args = H.beatArgs(b);
  const sig = /create or replace function public\.crew_heartbeat\(([\s\S]*?)\)\s*returns/.exec(sql375);
  const params = sig ? [...sig[1].matchAll(/\b(p_[a-z_]+)\s+(text|boolean)/g)].map((m) => m[1]) : [];
  ok("known pair: the beat's arguments are crew_heartbeat's parameters, by name, every one", params.length === 7 && Object.keys(args).join() === params.join(), { args: Object.keys(args), params });
  ok("…carrying what the beat says", args.p_device === b.device && args.p_surface === "pass" && args.p_app === "web" && args.p_app_build === "0c040e6"
    && args.p_feed === "live" && args.p_alerts_on === true && args.p_wake_lock === false, args);
  const client = (answer) => { const calls = []; return { calls, rpc: async (fn, a) => { calls.push([fn, a]); if (answer instanceof Error) throw answer; return answer; } }; };
  const c1 = client({ data: "2026-10-11T15:00:00Z", error: null });
  ok("sent: kept", (await H.sendBeat(c1, b)) === "kept" && c1.calls.length === 1 && c1.calls[0][0] === "crew_heartbeat" && c1.calls[0][1].p_device === b.device);
  ok("before 0375 is pasted (PGRST202): missing — said quietly, tried again next beat",
    (await H.sendBeat(client({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crew_heartbeat(p_alerts_on, p_app) in the schema cache" } }), b)) === "missing");
  ok("any other answer: refused", (await H.sendBeat(client({ data: null, error: { code: "42501", message: "not authorized" } }), b)) === "refused");
  ok("no answer at all: offline", (await H.sendBeat(client(new TypeError("Load failed")), b)) === "offline" && (await H.sendBeat(null, b)) === "offline");
}

// ── when a beat goes ─────────────────────────────────────────────────────────────────────────────────────────────────
// A clock that moves only when told: timers in order of when they are due.
function fakeClock(start = 1_760_000_000_000) {
  let now = start, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    after(fn, ms) { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    cancel(id) { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await tick();
      }
      now = end;
      await tick();
    },
  };
}
{
  const clock = fakeClock();
  const sent = [];
  const beats = H.beater((b) => { sent.push({ ...b, at: clock.now() }); }, clock);
  const base = { device: "d1d1d1d1-0000-4000-8000-000000000000", surface: "pass", app: "web", build: null, feed: "unknown", alertsOn: false, wakeLock: false };
  beats.say(base);
  await clock.advance(0);
  ok("the first beat goes at once", sent.length === 1 && sent[0].feed === "unknown");
  await clock.advance(59_999);
  ok("nothing changes: nothing more for a minute", sent.length === 1);
  await clock.advance(1);
  ok("…then the same beat again, a minute on", sent.length === 2 && sent[1].at - sent[0].at === H.BEAT_MS);
  await clock.advance(10_000);
  beats.say({ ...base, feed: "live" });
  await clock.advance(0);
  ok("a change goes at once — the feed is live", sent.length === 3 && sent[2].feed === "live");
  beats.say({ ...base, feed: "live" });
  await clock.advance(30_000);
  ok("being told the same thing again is no beat, and does not move the minute", sent.length === 3);
  await clock.advance(30_000);
  ok("…the minute after the last beat, it goes", sent.length === 4 && sent[3].at - sent[2].at === H.BEAT_MS);
  await clock.advance(500);
  beats.say({ ...base, feed: "reconnecting" }); await clock.advance(300);
  beats.say({ ...base, feed: "down" }); await clock.advance(300);
  beats.say({ ...base, feed: "reconnecting" }); await clock.advance(300);
  ok("a flapping feed inside two seconds of a beat waits for the gap", sent.length === 4);
  await clock.advance(H.BEAT_GAP_MS);
  ok("…and then goes once, with the last word", sent.length === 5 && sent[4].feed === "reconnecting" && sent[4].at - sent[3].at === H.BEAT_GAP_MS, sent.slice(3).map((s) => [s.feed, s.at - sent[3].at]));
  await clock.advance(5_000);
  beats.say({ ...base, feed: "live" }); await clock.advance(0);
  const settled = sent.length;
  beats.say({ ...base, feed: "reconnecting" }); await clock.advance(300);
  beats.say({ ...base, feed: "live" }); await clock.advance(10_000);
  ok("a blip inside the gap that ends where it started is no beat at all", settled === 6 && sent.length === settled && sent.at(-1).feed === "live",
    sent.slice(5).map((s) => s.feed));
  beats.stop();
  await clock.advance(10 * 60_000);
  ok("stopped: nothing at all, however long, and no timer left waiting", sent.length === settled && clock.pending() === 0);
  beats.say({ ...base, feed: "live" });
  await clock.advance(0);
  ok("told again after a stop — the page back, the Pass open again — it goes at once, even unchanged", sent.length === settled + 1 && sent.at(-1).feed === "live");
  // A send that throws, or whose promise is refused: the clock goes on.
  let calls = 0;
  const shaky = H.beater(() => { calls++; if (calls === 1) throw new Error("boom"); return Promise.reject(new Error("offline")); }, clock);
  shaky.say(base);
  await clock.advance(0);
  await clock.advance(H.BEAT_MS);
  await clock.advance(H.BEAT_MS);
  ok("a beat that fails costs only itself: the next ones go on time", calls === 3, calls);
  shaky.stop();
}
{
  const fiveMin = /h\.feed = 'live'\s+and h\.last_seen > now\(\) - interval '(\d+) minutes'/.exec(sql376);
  ok("known pair: 0376 calls a Pass deaf after five minutes — five beats missed, not one",
    !!fiveMin && Number(fiveMin[1]) * 60_000 >= 5 * H.BEAT_MS, fiveMin?.[1]);
  ok("the card calls a device away after two missed beats and a margin", H.AWAY_AFTER_S * 1000 >= 2 * H.BEAT_MS + 10_000 && H.AWAY_AFTER_S * 1000 < 5 * H.BEAT_MS);
  ok("the card asks every half minute", H.DEVICES_POLL_MS === 30_000);
  const win10 = /h\.last_seen > now\(\) - interval '(\d+) minutes'\s+order by \(h\.surface = 'pass'\) desc/.exec(sql375);
  ok("known pair: crew_devices is the last ten minutes", win10?.[1] === "10", win10?.[1]);
}

// ── the card's words ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok("seen: just now, seconds, minutes, hours", H.seenWords(2) === "seen just now" && H.seenWords(12.7) === "seen 12 s ago"
    && H.seenWords(59) === "seen 59 s ago" && H.seenWords(60) === "seen 1 min ago" && H.seenWords(599) === "seen 9 min ago"
    && H.seenWords(7300) === "seen 2 h ago" && H.seenWords(-4) === "seen just now");
  const row = { device_id: "7d1e0c2a-5b6f-4c8d-9e0f-1a2b3c4d5e6f", surface: "pass", user_id: "u", display_name: "Sam", role: "server",
    app: "web", app_build: "0c040e6", feed: "live", alerts_on: true, wake_lock: true, last_seen: "2026-10-11T15:00:00Z", seen_s: 12 };
  const v = H.deviceView(row, 12);
  ok("a device on the Pass, hearing: who, Live (in its tone), and the rest in words",
    v.who === "Sam" && v.feed === "Live" && v.tone === "ok" && v.hearing === true && v.line === "Pass · alerts on · seen 12 s ago"
    && v.meta === "Web 0c040e6 · screen stays on" && v.key === `${row.device_id}:pass`, v);
  const words = [["reconnecting", "Reconnecting", "warn"], ["down", "Down", "crit"], ["signed-out", "Signed out", "crit"], ["unknown", "Unknown", ""], ["garbage", "Unknown", ""]]
    .map(([feed, word, tone]) => { const x = H.deviceView({ ...row, feed }, 12); return x.feed === word && x.tone === tone && x.hearing === false; });
  ok("each feed in its word — the tone only repeats it — and none of them is hearing", words.every(Boolean), words);
  const away = H.deviceView(row, H.AWAY_AFTER_S + 1);
  ok("two beats missed: Away, whatever it last said, and not hearing", away.feed === "Away" && away.tone === "warn" && away.hearing === false && away.line.endsWith("seen 2 min ago"), away);
  ok("still there at the edge", H.deviceView(row, H.AWAY_AFTER_S).feed === "Live");
  const app = H.deviceView({ ...row, app: "ios", app_build: "1.0 (42)", alerts_on: false, wake_lock: false, display_name: "  ", role: "event_manager", surface: "live_ops" }, 75);
  ok("the app, its build; alerts off; a screen that can sleep; no name — the role, in lib/roles' word; another screen",
    app.meta === "iPhone app 1.0 (42) · screen can sleep" && app.line === "Live Ops · alerts off · seen 1 min ago" && app.who === "Event Manager", app);
  ok("no build said: just the app", H.deviceView({ ...row, app_build: null }, 1).meta === "Web · screen stays on");
}

// ── the hook, run ────────────────────────────────────────────────────────────────────────────────────────────────────
// Just enough of React to call a hook as a component does. A module binds `react` once, so — as React's own
// dispatcher does — each call goes to whichever host is rendering. Effects run after the render, in order, each only
// when a dep changed, its last cleanup first; useSyncExternalStore subscribes once, and a store's call re-renders.
let rendering = null;
const React = {
  useState: (...a) => rendering.useState(...a),
  useRef: (...a) => rendering.useRef(...a),
  useEffect: (...a) => rendering.useEffect(...a),
  useSyncExternalStore: (...a) => rendering.useSyncExternalStore(...a),
};
function hookHost() {
  const slots = [];
  const queued = [];
  let i = 0, dirty = false, hook = null, args = [];
  const self = {
    useState(init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: typeof init === "function" ? init() : init };
      const s = slots[k];
      return [s.v, (nv) => { const v = typeof nv === "function" ? nv(s.v) : nv; if (!Object.is(v, s.v)) { s.v = v; dirty = true; } }];
    },
    useRef(init) { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
    useEffect(effect, deps) {
      const k = i++;
      const was = slots[k];
      if (!was || !deps || deps.length !== was.deps.length || deps.some((d, j) => !Object.is(d, was.deps[j]))) queued.push({ k, effect, deps: deps ?? [] });
    },
    useSyncExternalStore(subscribe, snapshot) {
      const k = i++;
      if (!slots[k]) slots[k] = { unsub: subscribe(() => { dirty = true; }) };
      return snapshot();
    },
  };
  // `children`: what a child's own mount effects do in the same commit — React runs those before the parent's.
  const render = (children) => {
    i = 0; queued.length = 0;
    rendering = self;
    try { hook(...args); } finally { rendering = null; }
    children?.();
    for (const q of queued.splice(0)) {
      slots[q.k]?.cleanup?.();
      const c = q.effect();
      slots[q.k] = { deps: q.deps, cleanup: typeof c === "function" ? c : null };
    }
  };
  const settle = () => { for (let n = 0; dirty && n < 50; n++) { dirty = false; render(); } };
  return {
    mount(h, ...a) { hook = h; args = a; render(); settle(); },
    update(...a) { args = a; render(); settle(); },
    /** A render whose children's mount effects run first, as the Pass's do when AdminPage opens it. */
    updateWithChildren(children, ...a) { args = a; render(children); settle(); },
    settle,
    unmount() { for (const s of slots) { s?.cleanup?.(); s?.unsub?.(); } },
  };
}

// A module compiled from its TypeScript, its imports answered by `mods` (the rest is a test that needs fixing).
function compile(rel, mods) {
  const out = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
    if (spec in mods) return mods[spec];
    throw new Error(`unexpected import ${spec} in ${rel}`);
  });
  return mod.exports;
}

// The page around it: a window that is an event target with timers and storage, a document whose visibility the test
// sets, navigator's wake lock, and Date.now on the test's clock.
const clock = fakeClock();
const realNow = Date.now;
Date.now = () => clock.now();
const kept = new Map();
let storageBroken = false;
class FakeWindow extends EventTarget {
  setTimeout(fn, ms) { return clock.after(fn, ms); }
  clearTimeout(h) { clock.cancel(h); }
  get localStorage() {
    if (storageBroken) throw new Error("SecurityError: the operation is insecure");
    return { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); } };
  }
}
globalThis.window = new FakeWindow();
const doc = new EventTarget();
doc.visibilityState = "visible";
globalThis.document = doc;
const setVisible = (v) => { doc.visibilityState = v ? "visible" : "hidden"; doc.dispatchEvent(new Event("visibilitychange")); };
// navigator.wakeLock: a request answers a sentinel the browser may release (the page hidden) or the page releases.
const sentinels = [];
const wakeLock = {
  async request() {
    const s = new EventTarget();
    s.released = false;
    s.release = async () => { if (!s.released) { s.released = true; s.dispatchEvent(new Event("release")); } };
    sentinels.push(s);
    return s;
  },
};
Object.defineProperty(globalThis, "navigator", { value: { wakeLock }, configurable: true, writable: true });
process.env.NEXT_PUBLIC_BUILD_COMMIT = "0c040e6f00baa1c2";

// One page: lib/heartbeat and lib/useWakeLock real, the alerts answers and the Supabase client stood in.
function page({ appBuild = false, nativePushOn = false, native = false, platform = "web" } = {}) {
  const host = hookHost();
  const heartbeat = libLoader()("lib/heartbeat.ts");
  const wake = compile("lib/useWakeLock.ts", { react: React });
  const answers = { web: "granted", native: "unknown" };
  const calls = [];
  const rpcAnswer = { value: { data: null, error: null } };
  const supabase = { rpc: (fn, a) => { calls.push({ fn, ...a, at: clock.now() }); return Promise.resolve(rpcAnswer.value); } };
  const hookMod = compile("components/usePassHeartbeat.ts", {
    react: React,
    "@/lib/supabase": { supabase },
    "@/lib/native": { APP_BUILD: appBuild, isNativeApp: () => native, nativePlatform: () => (native ? platform : "web") },
    "@/lib/nativePush": { NATIVE_PUSH_ON: nativePushOn },
    "@/lib/useWakeLock": wake,
    "@/lib/heartbeat": heartbeat,
    "./DeviceAlerts": { useAlertPermission: () => answers.web },
    "./AppAlerts": { useAppAlerts: () => ({ state: answers.native, turnOn: async () => null }) },
  });
  return { host, heartbeat, wake, answers, calls, rpcAnswer, use: hookMod.usePassHeartbeat };
}
const passFeedSays = (state) => window.dispatchEvent(new CustomEvent("gt3:pass-feed", { detail: { state, at: clock.now() } }));

{
  const p = page();
  p.host.mount(p.use, false);
  await clock.advance(2 * 60_000);
  ok("the hook, mounted with the Pass closed: not one beat", p.calls.length === 0, p.calls.length);

  p.host.update(true);
  await clock.advance(0);
  const first = p.calls[0];
  ok("the Pass opens: a beat at once, to crew_heartbeat", p.calls.length === 1 && first.fn === "crew_heartbeat", p.calls);
  ok("…the screen, the app, the web's commit in seven characters, alerts on (the browser said yes), the screen not kept on yet",
    first?.p_surface === "pass" && first?.p_app === "web" && first?.p_app_build === "0c040e6" && first?.p_alerts_on === true && first?.p_wake_lock === false, first);
  ok("…its feed unknown until the Pass says", first?.p_feed === "unknown");
  ok("…and this install's id, minted once and kept", /^[0-9a-f-]{36}$/.test(first?.p_device ?? "") && kept.get("gt3-device-id") === first?.p_device, { id: first?.p_device, kept: kept.get("gt3-device-id") });

  passFeedSays("live");
  p.host.settle();
  await clock.advance(H.BEAT_GAP_MS);
  ok("the Pass says its feed is live: the next beat says so, within the gap", p.calls.length === 2 && p.calls[1].p_feed === "live" && p.calls[1].p_device === first.p_device, p.calls.map((c) => c.p_feed));

  await clock.advance(H.BEAT_MS - 1);
  ok("nothing changes: quiet for the rest of the minute", p.calls.length === 2);
  await clock.advance(1);
  ok("…then the minute's beat, the same words", p.calls.length === 3 && p.calls[2].p_feed === "live" && p.calls[2].at - p.calls[1].at === H.BEAT_MS);

  // The Pass's own screen kept on: lib/useWakeLock — the module the hook reads — run as the page runs it, beside the
  // hook (AdminPage calls both with svc), and the browser letting the lock go.
  ok("compiled: lib/useWakeLock, with its held state — nothing held yet",
    typeof p.wake.wakeLockHeld === "function" && typeof p.wake.onWakeLock === "function" && p.wake.wakeLockHeld() === false);
  const pw = hookHost();
  pw.mount(p.wake.useWakeLock, true);
  await tick(); await tick();
  p.host.settle();
  await clock.advance(H.BEAT_GAP_MS);
  ok("the screen is kept on (the browser granted the lock): held, and the next beat says so",
    p.wake.wakeLockHeld() === true && p.calls.at(-1)?.p_wake_lock === true && p.calls.length === 4, { held: p.wake.wakeLockHeld(), calls: p.calls.length, last: p.calls.at(-1)?.p_wake_lock });
  await sentinels.at(-1).release();
  p.host.settle();
  await clock.advance(H.BEAT_GAP_MS);
  ok("the browser lets the lock go: not held, and the next beat says so", p.wake.wakeLockHeld() === false && p.calls.at(-1)?.p_wake_lock === false && p.calls.length === 5);
  pw.unmount();

  p.answers.web = "denied";
  p.host.update(true);
  await clock.advance(H.BEAT_GAP_MS);
  ok("alerts blocked on this phone: the next beat says alerts off", p.calls.at(-1)?.p_alerts_on === false && p.calls.length === 6);

  const n0 = p.calls.length;
  setVisible(false);
  p.host.settle();
  await clock.advance(5 * 60_000);
  ok("the page hidden — another app, the phone locked: not one beat in five minutes", p.calls.length === n0, p.calls.length - n0);
  setVisible(true);
  p.host.settle();
  await clock.advance(0);
  ok("…back: a beat at once", p.calls.length === n0 + 1);

  p.rpcAnswer.value = { data: null, error: { code: "PGRST202", message: "Could not find the function public.crew_heartbeat" } };
  await clock.advance(2 * H.BEAT_MS);
  ok("before 0375 is pasted every beat is refused, quietly — and the next still goes on time", p.calls.length === n0 + 3, p.calls.length - n0);
  p.rpcAnswer.value = { data: null, error: null };

  const n1 = p.calls.length;
  p.host.update(false);
  await clock.advance(10 * 60_000);
  ok("the Pass closed: no more beats", p.calls.length === n1);
  p.host.update(true);
  await clock.advance(0);
  ok("…opened again: a beat at once, from the same device", p.calls.length === n1 + 1 && p.calls.at(-1).p_device === first.p_device);

  const n2 = p.calls.length;
  p.host.unmount();
  passFeedSays("down");
  await clock.advance(10 * 60_000);
  ok("the console gone: not one beat, and the Pass's word no longer heard", p.calls.length === n2 && p.heartbeat.passFeed() === "live", p.heartbeat.passFeed());
}

{
  // The Pass says its feed in the instant it mounts — its own mount effect, which React runs before AdminPage's — so
  // the word must already be listened for when the Pass opens, not from the effect that sees it open.
  const p = page();
  p.host.mount(p.use, false);
  p.host.updateWithChildren(() => passFeedSays("live"), true);
  await clock.advance(0);
  ok("the Pass says its feed is live the instant it opens, before the page's own effects run: heard — the first beat says live",
    p.calls.length === 1 && p.calls[0].p_feed === "live", p.calls.map((c) => c.p_feed));
  p.host.unmount();
}

{
  // A browser that will not keep anything (a locked-down private window): one id for the visit.
  kept.clear();
  storageBroken = true;
  const p = page();
  p.host.mount(p.use, true);
  await clock.advance(0);
  await clock.advance(H.BEAT_MS);
  ok("storage refused: the beats still go, under one id for this visit",
    p.calls.length === 2 && p.calls[0].p_device === p.calls[1].p_device && /^[0-9a-f-]{36}$/.test(p.calls[0].p_device) && kept.size === 0, p.calls.map((c) => c.p_device));
  p.host.unmount();
  storageBroken = false;
}

{
  // The iPhone app, its alerts live and allowed, the bridge having said the app's version.
  const p = page({ appBuild: true, nativePushOn: true, native: true, platform: "ios" });
  p.answers.web = "unsupported";
  p.answers.native = "granted";
  p.host.mount(p.use, true);
  await clock.advance(0);
  ok("in the app: 'ios', no build until the phone says, alerts on from iOS's yes", p.calls[0]?.p_app === "ios" && p.calls[0]?.p_app_build === null && p.calls[0]?.p_alerts_on === true, p.calls[0]);
  p.heartbeat.setAppBuild("1.0 (42)");
  p.host.settle();
  await clock.advance(H.BEAT_GAP_MS);
  ok("…the bridge says the version (App.getInfo): the next beat names it", p.calls.at(-1)?.p_app_build === "1.0 (42)" && p.calls.length === 2, p.calls.at(-1));
  p.answers.native = "denied";
  p.host.update(true);
  await clock.advance(H.BEAT_GAP_MS);
  ok("…alerts turned off in the iPhone's Settings: alerts off", p.calls.at(-1)?.p_alerts_on === false);
  p.host.unmount();
  const q = page({ appBuild: true, nativePushOn: false, native: true, platform: "ios" });
  q.answers.native = "granted";
  q.host.mount(q.use, true);
  await clock.advance(0);
  ok("an app build whose alerts are not live yet (NATIVE_PUSH_ON off) is never alerts on", q.calls[0]?.p_alerts_on === false);
  q.host.unmount();
}

Date.now = realNow;
console.log(`WHO IS WATCHING THE PASS (lib/heartbeat, components/usePassHeartbeat, lib/useWakeLock): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
