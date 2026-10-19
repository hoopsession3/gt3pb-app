// R38 — WHAT A PHONE ASKS FOR, AND WHEN (2026-10-19 — the fresh audit's performance pass, PERF11 and PERF F6).
//
// The reads the screens make, made once and only when they say something: a screen whose channel is down reads once as
// it rejoins, not twice with the signal's refresh (PERF11-13), and a channel asks a change's own row whether its screen
// shows it (the order history, F6); the ordering read is one store per city, read on screen (PERF11-10); Find Us asks
// for the road ahead, not every stop ever held, and reads every event's RSVP at once (PERF11-03, -11); Team reads the
// crew and counts the customers (PERF11-09); the live event's catalog is read for the event, not for every order (F6);
// an unchanged menu changes nothing (PERF11-12). And what moves on the screen: the announcement bar and the reserve cards
// hold the place they had (PERF11-06); a pull restyles the page alone (PERF11-15); the service worker preloads a page and
// keeps the fonts (PERF11-07, run in sw.test.mjs) and registers after the page; a route's script has a budget, and the
// console is weighed (PERF11-02, -04).
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { componentLoader, domReady } from "./fixtures/domHost.mjs";
import { routeLoader } from "./fixtures/moneyWorld.mjs";
import { weightVerdict, WEIGHT, WEIGHT_BUDGET } from "./design.ratchet.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const { render, screen, act, cleanup } = domReady();
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const settled = async () => { for (let i = 0; i < 4; i++) await settle(); };

// ── a channel stand-in: what lib/realtime opens, and its states ─────────────────────────────────────────────────────
function realtimeWorld() {
  const channels = [];
  const sb = {
    channel(name) {
      const ch = { name, handlers: [], removed: false, on(_t, filter, cb) { this.handlers.push({ filter, cb }); return this; }, subscribe(cb) { this.status = cb; return this; } };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.removed = true; return Promise.resolve(); },
  };
  return { sb, channels };
}
// A clock the test turns by hand, for the module's waits (the coalescer's 300 ms, the rejoin's 5 s).
function handClock() {
  let now = 0;
  const list = [];
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const fake = {
    install() {
      globalThis.setTimeout = (fn, ms) => { list.push({ at: now + (ms ?? 0), fn }); return list.length; };
      globalThis.clearTimeout = (id) => { if (typeof id === "number" && list[id - 1]) list[id - 1].fn = null; };
    },
    uninstall() { globalThis.setTimeout = real.set; globalThis.clearTimeout = real.clear; },
    advance(ms) {
      now += ms;
      for (let again = true; again;) {
        again = false;
        for (const t of list) if (t.fn && t.at <= now) { const f = t.fn; t.fn = null; f(); again = true; }
      }
    },
  };
  return fake;
}

// ── 1 · one catch-up read, not two (PERF11-13), and a change's row asked (F6) ──────────────────────────────────────
{
  const w = realtimeWorld();
  const load = componentLoader({ "@/lib/supabase": { supabase: w.sb } });
  const RT = load("lib/realtime.ts");
  const clock = handClock();
  const reads = { a: 0, b: 0, c: 0 };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  clock.install();
  try {
    const stopA = RT.watchTables("orders", { current: () => { reads.a++; } });
    const stopB = RT.watchTables([{ table: "orders", when: (row) => row.status === "done" || row.id === "shown-1" }], { current: () => { reads.b++; } });
    const stopC = RT.watchTables("events", { current: () => { reads.c++; } });
    const [chA, chB, chC] = w.channels;
    for (const ch of [chA, chB, chC]) ch.status("SUBSCRIBED");
    ok("a channel's first join reads nothing (its screen has read)", reads.a === 0 && reads.b === 0 && reads.c === 0, reads);

    chA.handlers[0].cb({ new: { id: "o-1", status: "making" } });
    chA.handlers[0].cb({ new: { id: "o-2", status: "making" } });
    clock.advance(300);
    ok("a burst of changes is one read (the coalescer)", reads.a === 1, reads);

    chB.handlers[0].cb({ new: { id: "o-9", status: "making" } });
    chB.handlers[0].cb({ new: { id: "o-9", status: "ready" } });
    clock.advance(1000);
    ok("asked of the change's own row: a ticket moving through the kitchen is no change to the history — no read", reads.b === 0, reads);
    chB.handlers[0].cb({ new: { id: "o-9", status: "done" } });
    clock.advance(300);
    ok("…an order becoming done is — one read", reads.b === 1, reads);
    chB.handlers[0].cb({ new: {}, old: { id: "shown-1" } });
    clock.advance(300);
    ok("…and a delete is asked by its key: one the history shows is read again", reads.b === 2, reads);
    chB.handlers[0].cb({ new: { id: "shown-1", status: "ready" } });
    clock.advance(300);
    ok("…as is one it shows moving back (an undo: done → ready) — the change a filter on \"done\" would never hear", reads.b === 3, reads);

    ok("changedRow: the new row, or a delete's old key, or nothing", JSON.stringify(RT.changedRow({ new: { id: 1 } })) === '{"id":1}'
      && JSON.stringify(RT.changedRow({ new: {}, old: { id: 2 } })) === '{"id":2}' && JSON.stringify(RT.changedRow({})) === "{}");

    // The signal drops and comes back: A's and B's channels break, C's never noticed.
    chA.status("CHANNEL_ERROR"); chB.status("TIMED_OUT");
    reads.a = reads.b = reads.c = 0;
    window.dispatchEvent(new Event("online"));
    await flush();
    ok("the signal back: a screen whose channel held reads at once; the two whose channels are down wait for their rejoin", reads.c === 1 && reads.a === 0 && reads.b === 0, reads);
    chA.status("SUBSCRIBED");
    chA.handlers[0].cb({ new: { id: "o-3", status: "new" } });   // a change landing as the channel rejoins
    clock.advance(300);
    ok("…each reads once as it rejoins — through its coalescer, with a change that lands beside it — never twice", reads.a === 1, reads);
    clock.advance(5000);
    await flush();
    ok("…and the rejoin's wait passing reads nothing more for the one that rejoined", reads.a === 1, reads);
    ok("…the one that never rejoined (Realtime itself down) reads anyway after the wait — never left as it was", reads.b === 1, reads);

    reads.a = reads.b = reads.c = 0;
    await RT.refreshLive();
    ok("a pull to refresh reads every screen at once, rejoining or not", reads.a === 1 && reads.b === 1 && reads.c === 1, reads);

    stopA(); stopB(); stopC();
    reads.a = reads.b = reads.c = 0;
    await RT.refreshLive();
    ok("a screen gone is no longer read, and its channel is let go", reads.a + reads.b + reads.c === 0 && w.channels.slice(0, 3).every((c) => c.removed));
  } finally { clock.uninstall(); }
  const rt = code(read("lib/realtime.ts"));
  ok("the resume after 30 s away leaves a rejoining screen to its rejoin too", /void refreshLive\(\{ skipRejoining: true \}\);\s*hiddenAt = 0;/.test(rt));
}

// ── 2 · the ordering read: one store per city (PERF11-10) ───────────────────────────────────────────────────────────
{
  const asked = [];
  const w = realtimeWorld();
  const answers = { market_live: { data: null, error: null }, live_status: { data: { is_live: false, preorder_lead_h: null, current_stop_id: null }, error: null }, stops: { data: [], error: null } };
  const chain = (table) => {
    const q = new Proxy({}, { get: (_o, k) => (k === "then" ? (res, rej) => Promise.resolve(answers[table] ?? { data: null, error: null }).then(res, rej) : () => q) });
    return q;
  };
  const sb = { ...w.sb, from: (t) => { asked.push(t); return chain(t); } };
  const load = componentLoader({ "@/lib/supabase": { supabase: sb } });
  const { useOrderingOpen } = load("components/useOrderingOpen.ts");
  const seen = [];
  function Asker({ name }) { const o = useOrderingOpen(true, "greenville"); seen.push([name, o.checked, o.open]); return h("p", null, `${name}:${o.checked ? (o.open ? "open" : "closed") : "?"}`); }
  render(h("div", null, h(Asker, { name: "menu" }), h(Asker, { name: "sheet" }), h(Asker, { name: "checkout" })));
  await settled();
  ok("three screens asking for one city: one read of its three rows — not one a screen", asked.filter((t) => t === "market_live").length === 1 && asked.filter((t) => t === "stops").length === 1, asked);
  ok("…each screen has the answer (closed: nothing live, no stop)", !!screen.getByText("menu:closed") && !!screen.getByText("sheet:closed") && !!screen.getByText("checkout:closed"));
  ok("…and one channel hears the road and the truck's switch for all of them", w.channels.filter((c) => /stops/.test(c.name) && /live_status/.test(c.name)).length === 1, w.channels.map((c) => c.name));
  cleanup();
  const hook = code(read("components/useOrderingOpen.ts"));
  ok("the minute's read is only while the page is on screen (the store's clock), and a return reads at once",
    /every: \{ ms: 60_000 \},/.test(hook) && /back: true,/.test(hook) && /tables: \(\) => \["live_status", "stops"\],/.test(hook) && /const now = useMinute\(\);/.test(hook) && !/setInterval/.test(hook));
}

// ── 3 · the RSVP row: told by the page, its sign-in loaded when asked for (PERF11-11) ───────────────────────────────
{
  const asked = [];
  const chain = () => { const q = new Proxy({}, { get: (_o, k) => (k === "then" ? (res) => Promise.resolve({ data: null, error: null }).then(res) : () => q) }); return q; };
  const sb = { from: (t) => { asked.push(t); return chain(); } };
  const load = componentLoader({
    "@/lib/supabase": { supabase: sb },
    "@/components/AppProvider": { useAppStable: () => ({ toast: () => {} }) },
    "@/components/AuthProvider": { useAuth: () => ({ user: { id: "u-1", email: "made-up@example.test" } }) },
    "@/components/kit": { InfoRow: ({ name, trailing }) => h("div", null, h("span", null, name), trailing) },
    "@/components/AddToCalendar": { __esModule: true, default: () => null },
    "@/components/Sheet": { __esModule: true, default: ({ open, children }) => (open ? h("div", null, children) : null) },
    "next/dynamic": { __esModule: true, default: () => function Lazy() { return null; } },
    "@/lib/copy": { useSiteCopy: () => (k) => k },
  });
  const { RsvpRow } = load("components/RsvpRow.tsx");
  const ev = { id: "e-1", title: "Made-up Market", day: "2026-11-07", start_time: "10:00", end_time: "14:00", location_text: null, blurb: null, member_only: false, going_count: 3 };
  render(h(RsvpRow, { ev, going: true }));
  await settled();
  ok("told by the page they're going: the row says so (pressed) — and asks the database nothing of its own",
    screen.getByRole("button", { name: /Going — Made-up Market/ }).getAttribute("aria-pressed") === "true" && asked.length === 0, asked);
  cleanup();
  const later = render(h(RsvpRow, { ev, going: false }));
  await settled();
  const before = screen.queryByRole("button", { name: /I'm in — Made-up Market/ })?.getAttribute("aria-pressed") ?? null;
  later.rerender(h(RsvpRow, { ev, going: true }));
  await settled();
  const after = screen.queryByRole("button", { name: /Going — Made-up Market/ })?.getAttribute("aria-pressed") ?? null;
  ok("…the page's answer landing after the row is drawn: the row follows it (I'm in, then Going)",
    before === "false" && after === "true" && asked.length === 0, { before, after, asked });
  cleanup();
  render(h(RsvpRow, { ev }));
  await settled();
  ok("not told (a page that doesn't read them all): the row reads its own, as before", asked.filter((t) => t === "rsvps").length === 1, asked);
  cleanup();
  const row = code(read("components/RsvpRow.tsx"));
  ok("the sign-in form loads when its sheet opens, not with every guest's Find Us", /const SignIn = dynamic\(\(\) => import\("@\/components\/SignIn"\)\);/.test(row) && !/import SignIn from/.test(row));
  const fu = code(read("components/FindUs.tsx"));
  ok("Find Us reads every event's RSVP for this person once, and hands each row its answer — a failed read leaves each row to its own",
    /supabase\.from\("rsvps"\)\.select\("event_id"\)\.eq\("user_id", uid\)\.eq\("status", "going"\)\.in\("event_id", eventIds\.split\(","\)\)/.test(fu)
    && /<RsvpRow key=\{r\.id\} ev=\{toEventRow\(r\)\} going=\{goingAt\(r\.id\)\} \/>/.test(fu) && /return rsvps\.going \? rsvps\.going\.has\(id\) : undefined;/.test(fu)
    && /if \(!uid \|\| !rsvps \|\| rsvps\.uid !== uid\) return false;/.test(fu) && /setRsvps\(\{ uid, going:/.test(fu));
}

// ── 4 · Find Us asks for the road ahead (PERF11-03) ─────────────────────────────────────────────────────────────────
{
  const fu = code(read("components/FindUs.tsx"));
  ok("stops: public, not archived, and started in the last day and a half, still running by their close, or undated — no more",
    /\.from\("field_ops"\)\.select\(ROAD_COLS\)\.eq\("is_public", true\)\.eq\("kind", "stop"\)\.is\("archived_at", null\)\s*\.or\(`starts_at\.gte\.\$\{since\},ends_at\.gte\.\$\{nowIso\},starts_at\.is\.null`\)\.order\("starts_at", \{ ascending: true \}\)\.limit\(100\)/.test(fu)
    && /const since = new Date\(nowMs - 36 \* 3600 \* 1000\)\.toISOString\(\)/.test(fu));
  ok("events: public and not completed, bounded too — newest first, so events never marked done can't push one ahead out",
    /\.from\("field_ops"\)\.select\(ROAD_COLS\)\.eq\("is_public", true\)\.eq\("kind", "event"\)\.is\("completed_at", null\)\s*\.order\("day", \{ ascending: false \}\)\.limit\(100\)/.test(fu));
  ok("named columns still, never *; a failed read of either is an error, never an empty road",
    /const ROAD_COLS = "id, kind, name, public_title, day, starts_at, ends_at,/.test(fu) && !/field_ops"\)\.select\("\*"\)/.test(fu) && /if \(e1\) throw new Error\(e1\.message\);\s*if \(e0\) throw new Error\(e0\.message\);/.test(fu));
  ok("no 20-second poll: a safety read every five minutes, only while the page is on screen, beside the channel and the return",
    /const ROAD_SAFETY_MS = 5 \* 60_000;/.test(fu) && /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) void refreshQuietly\(\); \}, ROAD_SAFETY_MS\)/.test(fu) && !/setInterval\(refreshQuietly, 20000\)/.test(fu)
    && /useRealtimeTable\(\["field_ops", "live_status"\], refreshQuietly\);/.test(fu));
  // The rule the bound must not cut: every stop isStopAhead shows is inside it.
  const road = routeLoader({})("lib/road.ts");
  const now = Date.parse("2026-11-07T18:00:00Z"), since = now - 36 * 3600e3;
  const inBound = (s) => !s.archived_at && (s.starts_at == null || Date.parse(s.starts_at) >= since || (s.ends_at != null && Date.parse(s.ends_at) >= now));
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const stops = [
      { id: "a", starts_at: "2026-11-07T15:00:00Z", ends_at: null },                       // this afternoon
      { id: "b", starts_at: "2026-11-05T15:00:00Z", ends_at: "2026-11-08T02:00:00Z" },     // a three-day stop, still running
      { id: "c", starts_at: "2026-11-06T22:00:00Z", ends_at: null },                       // last night, within its grace
      { id: "d", starts_at: null, ends_at: null },                                         // undated
      { id: "e", starts_at: "2026-11-01T15:00:00Z", ends_at: "2026-11-01T20:00:00Z" },     // last week
      { id: "f", starts_at: "2026-11-09T15:00:00Z", ends_at: null },                       // ahead
    ];
    const shown = stops.filter((s) => road.isStopAhead(s, null));
    ok("the bound holds every stop the road would show (a three-day stop still running, last night's in its grace, undated) — and drops last week's",
      shown.every(inBound) && !inBound(stops[4]) && shown.map((s) => s.id).join() !== "", { shown: shown.map((s) => s.id) });
  } finally { Date.now = realNow; }
}

// ── 5 · Team, the history, the live event, the menu (PERF11-09, F6, PERF11-12) ───────────────────────────────────────
{
  const crew = code(read("app/crew/page.tsx"));
  ok("Team reads the crew (lib/roles STAFF_ROLES) and counts every account — never every customer's row; a failed read is said",
    /supabase\.from\("profiles"\)\.select\("\*"\)\.in\("role", STAFF_ROLES\)\.order\("display_name"\)/.test(crew) && /supabase\.from\("profiles"\)\.select\("id", \{ count: "exact", head: true \}\)/.test(crew)
    && /if \(crew\.error\) throw crew\.error;/.test(crew) && !/from\("profiles"\)\.select\("\*"\)\.order\("display_name"\)/.test(crew));
  ok("…customers counted as every account less the crew; a count that couldn't be read says nothing, never \"no customers\"",
    /const customerCount = total === null \? 0 : Math\.max\(0, total - staff\.length\);/.test(crew));
  const roles = routeLoader({})("lib/roles.ts");
  ok("…and STAFF_ROLES is exactly every role that isn't a member's (what the roster drew)", roles.STAFF_ROLES.slice().sort().join() === roles.ALL_ROLES.filter((r) => r !== "member").sort().join());
  ok("the order history reads again only for its own orders — one becoming done or void, or one it shows",
    /useRealtimeTable\(\[\{ table: "orders", when: \(row\) => row\.status === "done" \|\| row\.status === "void" \|\| shownIds\.current\.has\(String\(row\.id \?\? ""\)\) \}\], ordersState\.reload\);/.test(crew)
    && /shownIds\.current = new Set\(rows\.map\(\(o\) => o\.id\)\);/.test(crew));
  ok("the live event's catalog and costs are read for the event — on its going live, a product's change, and a minute's safety read on screen — not with every order",
    /useRealtimeTable\(\["products"\], loadSide, \{ enabled: !!liveId \}\);/.test(crew)
    && /const t = setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) loadSide\(\); \}, 60_000\);/.test(crew) && /const totals = await eventTotals\(supabase, eid\);\s*return \{ live: \{ ev: e as EventRow, stats: totals \} \};/.test(crew)
    && (() => { const i = crew.indexOf("function EventHUD() {"), hud = crew.slice(i, crew.indexOf("\nfunction ", i + 10)); const side = hud.slice(hud.indexOf("const loadSide = useCallback("), hud.indexOf("useEffect(() => { loadSide(); }, [loadSide]);"));
      return (hud.match(/from\("product_economics_live"\)/g) || []).length === 1 && /from\("product_economics_live"\)/.test(side) && /from\("event_economics"\)/.test(side) && (hud.match(/from\("event_economics"\)/g) || []).length === 1; })());
  ok("…and its 15-second reconcile only while the console is on screen", /const recon = setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) load\(\); \}, 15000\);/.test(crew));
  const ap = code(read("components/AppProvider.tsx"));
  ok("an unchanged menu changes nothing: the same answer keeps the values the 150 readers already hold",
    /setPrices\(\(was\) => \(sameJson\(was, nextPrices\) \? was : nextPrices\)\);/.test(ap) && /setRows\(\(was\) => \(was !== null && sameJson\(was, nextRows\) \? was : nextRows\)\);/.test(ap));
}

// ── 6 · a place held (PERF11-06) ───────────────────────────────────────────────────────────────────────────────────
{
  const holds = routeLoader({})("lib/holds.ts");
  localStorage.clear();
  holds.keepHold("bcast", 56);
  holds.keepHold("rsv", 248.4);
  ok("kept: each slot's height, whole pixels, under one key", localStorage.getItem("gt3-holds") === JSON.stringify({ bcast: 56, rsv: 248 }));
  holds.keepHold("rsv", 0);
  holds.keepHold("bcast", 5000);
  ok("…0 forgets one; a height past the cap is no measurement and isn't kept", localStorage.getItem("gt3-holds") === JSON.stringify({}));
  localStorage.setItem("gt3-holds", JSON.stringify({ bcast: 56, rsv: 248, "x-y": 40, big: 9000, bad: "60px" }));
  const d = document.documentElement;
  for (const a of [...d.attributes]) if (a.name.startsWith("data-hold-")) d.removeAttribute(a.name);
  new Function(holds.HOLD_SCRIPT)();
  ok("the head script holds each kept height on the page before its first paint — letters-only names, whole pixels up to the cap",
    d.hasAttribute("data-hold-bcast") && d.style.getPropertyValue("--hold-bcast") === "56px" && d.hasAttribute("data-hold-rsv") && d.style.getPropertyValue("--hold-rsv") === "248px"
    && !d.hasAttribute("data-hold-big") && !d.hasAttribute("data-hold-bad") && !d.hasAttribute("data-hold-x-y"), [...d.attributes].map((a) => a.name));
  localStorage.setItem("gt3-holds", "{not json");
  let quiet = true; try { new Function(holds.HOLD_SCRIPT)(); } catch { quiet = false; }
  ok("…and anything else in storage is ignored, quietly", quiet);
  holds.letGo("bcast");
  ok("let go: the page stops holding that place at once", !d.hasAttribute("data-hold-bcast") && d.style.getPropertyValue("--hold-bcast") === "" && d.hasAttribute("data-hold-rsv"));
  const css = read("app/tailwind.css");
  ok("the slot draws no box of its own, and holds the kept height only while it is empty — the cards' with the first card's own margin",
    /\.hold-slot\{display:contents\}/.test(css) && /html\[data-hold-bcast\] \.hold-slot\[data-hold="bcast"\]:empty\{display:block;height:var\(--hold-bcast\)\}/.test(css)
    && /html\[data-hold-rsv\] \.hold-slot\[data-hold="rsv"\]:empty\{display:block;height:var\(--hold-rsv\);margin-top:22px\}/.test(css)
    && /\.drop\{margin-top:22px;/.test(read("app/globals.css")));
  // The screen under the bar — or under the place held for it — doesn't pad for the status bar a second time (the native
  // smoke draws it on an iPhone; these hold every rule that asks).
  const nb = read("components/NativeBridge.css");
  const under = ':is(.app:has(>.bcast),html[data-hold-bcast] .app:has(>.hold-slot[data-hold="bcast"]))';
  ok("every rule under the bar counts its held place too: the screen, sign-in, the sticky chips; the title bar; both calendars",
    [" :is(.screen,.bookwrap){padding-top:6px}", " .auth{padding-top:40px}", " :is(.menu-chips,.cal-sticky){top:0}"].every((r) => nb.includes(under + r))
      && !/^\.app:has\(>\.bcast\)/m.test(nb)
      && read("components/TitleBar.tsx").includes("[.app:has(>.bcast)_&]:pt-0 [html[data-hold-bcast]_.app:has(>.hold-slot[data-hold=bcast])_&]:pt-0")
      && ["components/CompanyCalendar.tsx", "components/BrandCalendar.tsx"].every((f) => read(f).includes("[html[data-hold-bcast]_.app:has(>.hold-slot[data-hold=bcast]):has([data-tbar][data-compact])_&]:top-11!")));
  ok("the layout runs the hold script in the head, beside the viewer's", /<script dangerouslySetInnerHTML=\{\{ __html: HOLD_SCRIPT \}\} \/>/.test(read("app/layout.tsx")));

  // The bar, drawn: its slot from the start; shown, its height kept; read as none, let go.
  let answer = { data: [], error: null };
  let release;
  const w = realtimeWorld();
  const chain = () => { const q = new Proxy({}, { get: (_o, k) => (k === "then" ? (res) => new Promise((r) => { release = () => r(answer); }).then(res) : () => q) }); return q; };
  const sb = { ...w.sb, from: () => chain() };
  const load = componentLoader({ "@/lib/supabase": { supabase: sb } });
  const Banner = load("components/BroadcastBanner.tsx").default;
  const realRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList?.contains("bcast") ? { top: 0, bottom: 58, height: 58, left: 0, right: 390, width: 390 } : realRect.call(this); };
  try {
    localStorage.setItem("gt3-holds", JSON.stringify({ bcast: 56 }));
    d.setAttribute("data-hold-bcast", "");
    const { container } = render(h(Banner));
    await settle();
    const slot = container.querySelector('.hold-slot[data-hold="bcast"]');
    ok("before the read lands: the bar's slot is there, empty — holding its place — and the hold stands", !!slot && slot.children.length === 0 && d.hasAttribute("data-hold-bcast"));
    answer = { data: [{ id: "b-1", title: "Closed Sunday", body: "Back Monday at 7.", kind: "announcement", style: "info", audience: "all", cta_label: null, cta_href: null, active: true, starts_at: null, ends_at: null, created_at: "2026-11-01T00:00:00Z" }], error: null };
    release();
    await settled();
    ok("the read lands with a bar: drawn in the slot's place — the shell's own child, as every rule under the bar reads it — and its height kept for the next first paint",
      !!screen.queryByText("Closed Sunday") && container.querySelector(":scope > .bcast") !== null && !container.querySelector('.hold-slot[data-hold="bcast"]')
        && JSON.parse(localStorage.getItem("gt3-holds")).bcast === 58, localStorage.getItem("gt3-holds"));
    cleanup();
    d.setAttribute("data-hold-bcast", "");
    answer = { data: [], error: null };
    render(h(Banner));
    await settle();
    release();
    await settled();
    ok("read as none: the slot lets go at once, and the height is forgotten", !d.hasAttribute("data-hold-bcast") && JSON.parse(localStorage.getItem("gt3-holds")).bcast === undefined);
    cleanup();
    localStorage.setItem("gt3-holds", JSON.stringify({ bcast: 56 }));
    d.setAttribute("data-hold-bcast", "");
    answer = { data: null, error: { message: "fetch failed" } };
    render(h(Banner));
    await settle();
    release();
    await settled();
    ok("a read that failed: the slot lets go — and the height is kept (unknown is not none)", !d.hasAttribute("data-hold-bcast") && JSON.parse(localStorage.getItem("gt3-holds")).bcast === 56);
    cleanup();
  } finally { window.HTMLElement.prototype.getBoundingClientRect = realRect; }
  const rsv = code(read("components/Reserves.tsx"));
  ok("the reserve cards: their slot while loading; kept with the cards' own height; none lets go and forgets; a failed read lets go and keeps it",
    /if \(board\.status === "loading"\) return <div ref=\{slot\} className="hold-slot" data-hold="rsv" \/>;/.test(rsv)
    && /if \(board\.status === "error"\) \{ letGo\("rsv"\); return; \}/.test(rsv) && /keepHold\("rsv", heldHeight\(slot\.current, ":scope > \.drop"\)\)/.test(rsv)
    && /letGo\("rsv"\);\s*keepHold\("rsv", 0\);/.test(rsv) && /<div ref=\{slot\} className="hold-slot" data-hold="rsv">/.test(rsv));
}

// ── 7 · the pull restyles the page alone (PERF11-15), the worker registers after the page (PERF11-07) ──────────────
{
  const SS = routeLoader({})("lib/sheetStage.ts");
  const props = () => new Map();
  const main = { style: { p: props(), setProperty(k, v) { this.p.set(k, v); }, removeProperty(k) { this.p.delete(k); } } };
  const shell = { cls: new Set(), classList: { toggle(c, on) { if (on) shell.cls.add(c); else shell.cls.delete(c); }, add: (c) => shell.cls.add(c), remove: (c) => shell.cls.delete(c), contains: (c) => shell.cls.has(c) },
    style: { p: props(), setProperty(k, v) { this.p.set(k, v); }, removeProperty(k) { this.p.delete(k); } }, querySelector: (q) => (q === ":scope > main" ? main : null) };
  const me = Symbol("sheet");
  SS.stepBack(shell, me, true);
  SS.stepBackBy(shell, 0.4);
  ok("a pull's depth is written on the page (<main>), not on the shell every element sits under", main.style.p.get("--recede") === "0.4" && !shell.style.p.has("--recede") && shell.cls.has("pulling"));
  SS.stepBack(shell, me, false);
  ok("…and goes from there when the sheet does", !main.style.p.has("--recede") && !shell.cls.has("receded"));
  ok("--recede is registered as not inherited (the page's own)", /@property --recede \{ syntax: "<number>"; inherits: false; initial-value: 1; \}/.test(read("app/tailwind.css")));
  const swr = code(read("components/ServiceWorkerRegister.tsx"));
  ok("the worker registers after the page has loaded, at a quiet moment — not in the first page's own seconds",
    /if \(document\.readyState === "complete"\) onLoad\(\);\s*else window\.addEventListener\("load", onLoad, \{ once: true \}\);/.test(swr) && /requestIdleCallback\(fn, \{ timeout: 1000 \}\)/.test(swr));
  // Drawn: the page has loaded (happy-dom's document is complete), and the register waits for the quiet moment.
  const registered = [], idles = [];
  const sw = { controller: null, register: (u, o) => { registered.push([u, o?.scope]); return new Promise(() => {}); }, addEventListener() {}, removeEventListener() {} };
  const hadSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker"), hadIdle = window.requestIdleCallback, env = process.env.NODE_ENV;
  Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
  window.requestIdleCallback = (cb, o) => { idles.push({ cb, timeout: o?.timeout }); return idles.length; };
  process.env.NODE_ENV = "production";
  try {
    const SWR = componentLoader({ "@/lib/native": { APP_BUILD: "" } })("components/ServiceWorkerRegister.tsx").default;
    render(h(SWR));
    await settled();
    const waited = registered.length === 0 && idles.length === 1 && idles[0].timeout === 1000;
    idles[0]?.cb();
    ok("…drawn: nothing is registered as the page draws — at the quiet moment (a second at most), the worker, once",
      waited && registered.length === 1 && registered[0][0] === "/sw.js" && registered[0][1] === "/", { registered, idles: idles.length, document: document.readyState });
    cleanup();
  } finally {
    process.env.NODE_ENV = env;
    window.requestIdleCallback = hadIdle;
    if (hadSw) Object.defineProperty(navigator, "serviceWorker", hadSw); else delete navigator.serviceWorker;
  }
}

// ── 8 · a budget, and the console weighed (PERF11-02, -04) ─────────────────────────────────────────────────────────
{
  const row = { js: 400, css: 90, chunks: 30 };
  const over = weightVerdict("/menu", { js: 321, css: 90, chunks: 30 }, row);
  ok("past the budget's 320 KB a route fails, whatever its row says — a row records growth; the budget refuses it", over.some((m) => /past the budget's 320 KB/.test(m)), over);
  const under = weightVerdict("/menu", { js: 319, css: 90, chunks: 30 }, { js: 319, css: 90, chunks: 30 });
  ok("…and under it the row decides, as before", under.length === 0, under);
  ok("every recorded row sits within the budget, and /crew within the console's line", Object.entries(WEIGHT).every(([p, r]) => r.js <= (p === "/crew" ? WEIGHT_BUDGET.console : WEIGHT_BUDGET.js)), WEIGHT);
  ok("the console is weighed: /crew has its row", !!WEIGHT["/crew"] && WEIGHT["/crew"].js > 300, WEIGHT["/crew"]);
  ok("…by the UI smoke, from its document", /const WEIGH_ONLY = \["\/crew"\];/.test(read("scripts/smoke.ui.mjs")) && /for \(const path of WEIGH_ONLY\)/.test(read("scripts/smoke.ui.mjs")));
}

const pkg = JSON.parse(read("package.json"));
ok("this file runs with every test", /node scripts\/r37\.test\.mjs && node scripts\/r38\.test\.mjs/.test(pkg.scripts.test));

console.log(`\nR38 — WHAT A PHONE ASKS FOR, AND WHEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
