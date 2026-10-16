// R13 (2026-10-16 — the 10/10 audit's performance pass, and two of its operations findings), run.
//
// The rules R13 added are pure modules, and this drives them: the shared stores every screen reads through
// (lib/sharedCore — one read, one channel, the newest answer standing), what kind of failure a read or a write got and
// which are reported (lib/failureClass, lib/failureReport), a banner's window kept by the screen (lib/broadcastWindow),
// the Pass's snapshot written when it changed (lib/passBoard snapDue), and the Brand Kit's thumbnails (lib/brandAssets.json).
// scripts/smoke.cjs holds the wiring (who calls what).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const S = load("lib/sharedCore.ts"), FC = load("lib/failureClass.ts"), FR = load("lib/failureReport.ts"), BW = load("lib/broadcastWindow.ts"), P = load("lib/passBoard.ts");
const tick = () => new Promise((r) => setTimeout(r, 0));

// A clock, timers and a page turned by hand.
function world() {
  let t = 0, seq = 0, visible = true;
  const timers = new Map();
  const returns = new Set();
  const env = {
    timers: {
      set: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
      clear: (id) => { timers.delete(id); },
      every: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms, every: ms }); return id; },
      stop: (id) => { timers.delete(id); },
    },
    visible: () => visible,
    onReturn: (fn) => { returns.add(fn); return () => returns.delete(fn); },
  };
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      if (due[1].every) due[1].at += due[1].every; else timers.delete(due[0]);
      due[1].fn();
    }
    t = end;
  };
  return { env, advance, setVisible: (v) => { visible = v; }, back: () => { for (const f of [...returns]) f(); }, timers };
}

// A read whose answers the test hands out, in any order.
function reads() {
  const out = [];
  return {
    out,
    read: (key, cur) => new Promise((resolve, reject) => { out.push({ key, cur, resolve, reject }); }),
  };
}

// ── lib/sharedCore: one read, one channel ──────────────────────────────────────────────────────────────────────────
{
  const w = world(), r = reads();
  let watching = 0, opened = 0;
  const changes = [];
  const store = S.createStore({ initial: [], read: r.read, watch: (key, run) => { watching++; opened++; changes.push(run); return () => { watching--; }; } }, w.env);
  const seen = [];
  const u1 = store.subscribe("all", () => seen.push("a"));
  const u2 = store.subscribe("all", () => seen.push("b"));
  const u3 = store.subscribe("all", () => seen.push("c"));
  ok("shared: three screens, one read and one channel", r.out.length === 1 && watching === 1, { reads: r.out.length, watching });
  r.out[0].resolve(["latte"]);
  await tick();
  ok("shared: the answer reaches every screen, once each", store.peek("all")[0] === "latte" && seen.join("") === "abc", seen);
  changes[0]();
  ok("shared: a change reads once for all of them", r.out.length === 2, r.out.length);
  r.out[1].resolve(["latte"]);
  await tick();
  ok("shared: an answer equal to what is here… (by default the same object only)", seen.length === 6, seen.length);
  u1(); u2();
  ok("shared: two screens leave — the channel stays for the third", watching === 1);
  u3();
  ok("shared: the last screen leaves — the channel waits a moment…", watching === 1);
  const again = store.subscribe("all", () => {});
  w.advance(S.LINGER_MS + 1);
  ok("shared: …and a screen that comes straight back finds it open, and reads nothing new", watching === 1 && opened === 1 && r.out.length === 2, { watching, opened, reads: r.out.length });
  again();
  w.advance(S.LINGER_MS + 1);
  ok("shared: left alone past the moment, the channel closes", watching === 0);
  ok("shared: what it last said is kept for the next screen to show at once", store.peek("all")[0] === "latte");
  const back = store.subscribe("all", () => {});
  ok("shared: the next screen opens it again and reads", watching === 1 && opened === 2 && r.out.length === 3, { watching, opened });
  back();
}

// ── the newest answer stands (F15) ─────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), r = reads();
  const store = S.createStore({ initial: "none", read: r.read, watch: () => () => {} }, w.env);
  const off = store.subscribe("me", () => {});
  void store.reload("me");                       // a second read, asked after the first
  r.out[1].resolve("ready");                     // the newer answer lands first…
  await tick();
  r.out[0].resolve("being made");                // …and the older one after it
  await tick();
  ok("newest: an older answer landing last does not put an older truth back", store.peek("me") === "ready", store.peek("me"));
  void store.reload("me");
  store.change("me", () => "cleared");           // a change made here, after that read was asked
  r.out[2].resolve("not cleared");
  await tick();
  ok("newest: a read asked before a change made here does not undo it", store.peek("me") === "cleared", store.peek("me"));
  void store.reload("me");
  r.out[3].resolve(undefined);
  await tick();
  ok("newest: a read that answers 'keep' keeps what is here", store.peek("me") === "cleared");
  void store.reload("me");
  r.out[4].reject(new Error("boom"));
  await tick();
  ok("newest: a read that throws keeps what is here", store.peek("me") === "cleared");
  void store.reload("me");
  r.out[5].resolve("done");
  await tick();
  ok("newest: a read asked after the change lands", store.peek("me") === "done");
  off();
}

// ── equal answers are not news; the clock reads only on screen; personal stores forget ──────────────────────────────
{
  const w = world(), r = reads();
  let told = 0;
  const store = S.createStore({
    initial: { orders: [] }, read: r.read, watch: () => () => {}, equal: S.sameJson,
    every: { ms: 20_000, when: (cur, n) => cur.orders.length > 0 || n % 3 === 0 }, back: true, personal: true,
  }, w.env);
  const off = store.subscribe("u1", () => { told++; });
  r.out[0].resolve({ orders: [] });
  await tick();
  ok("equal: an answer that is what is already here tells no screen", told === 0, told);
  w.advance(20_000); w.advance(20_000);
  ok("clock: with no order open, the clock skips two ticks in three", r.out.length === 1, r.out.length);
  w.advance(20_000);
  ok("clock: …and reads on the third (a minute)", r.out.length === 2, r.out.length);
  r.out[1].resolve({ orders: [{ id: "o1" }] });
  await tick();
  w.advance(20_000);
  ok("clock: with an order open, every 20 seconds", r.out.length === 3, r.out.length);
  w.setVisible(false);
  w.advance(60_000);
  ok("clock: a page no one is looking at reads nothing", r.out.length === 3, r.out.length);
  w.setVisible(true);
  w.back();
  ok("back: a return to the page reads again", r.out.length === 4, r.out.length);
  store.forget();
  ok("forget: a sign-out takes the person's things back to nothing at once", store.peek("u1").orders.length === 0);
  r.out[3].resolve({ orders: [{ id: "o1" }] });
  await tick();
  ok("forget: a read that left before the sign-out does not put them back", store.peek("u1").orders.length === 0, store.peek("u1"));
  off();
  w.advance(S.LINGER_MS + 1);
  ok("personal: a person's store is let go when its last screen has gone", store.counts().keys === 0, store.counts());
}

// ── lib/failureClass: what kind of no ─────────────────────────────────────────────────────────────────────────────
{
  const c = FC.failureClass;
  ok("failure: a missing column is the schema's", c({ code: "42703", message: 'column orders.eta does not exist' }) === "schema");
  ok("failure: PostgREST's schema cache not knowing a table is the schema's", c({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" }) === "schema");
  ok("failure: a grant or a row rule is permission", c({ code: "42501", message: "permission denied for table alerts" }) === "permission"
    && c({ message: 'new row violates row-level security policy for table "x"' }) === "permission");
  ok("failure: the database's words for a person are a refusal, whatever they say", c({ code: "P0001", message: "That stop does not exist any more." }) === "refusal"
    && c({ code: "23505", message: "duplicate key" }) === "refusal" && c({ code: "22P02", message: "invalid input syntax" }) === "refusal");
  ok("failure: no signal is the network's", c({ message: "TypeError: Failed to fetch" }) === "network" && c("Load failed") === "network"
    && c({ message: "The operation timed out." }) === "network");
  ok("failure: anything else the server named is 'other'", c({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }) === "other");
  const r = FC.reportable;
  ok("reportable: schema and permission are reported", r({ code: "42703", message: "x" }) === "schema" && r({ code: "42501", message: "x" }) === "permission");
  ok("reportable: a refusal and the network are not", r({ code: "P0001", message: "x" }) === null && r({ message: "Failed to fetch" }) === null);
  ok("reportable: a loader's own sentence (no code) is not — it does not say which kind it was", r(new Error("Couldn't load the plan")) === null && r("Couldn't load") === null);
  ok("reportable: an 'other' with a code is", r({ code: "PGRST116", message: "rows" }) === "other");
}

// ── lib/failureReport: once each, a few a page ────────────────────────────────────────────────────────────────────
{
  const sent = [];
  FR.reportFailure("load", { code: "42703", message: "column a does not exist" });
  ok("report: nothing is sent before the app installs the sender", sent.length === 0);
  FR.setFailureSender((m) => sent.push(m));
  FR.reportFailure("load", { code: "42703", message: "column a does not exist" });
  FR.reportFailure("load", { code: "42703", message: "column a does not exist" });
  ok("report: one report per kind of failure per page load", sent.length === 1, sent);
  ok("report: it says what was being done, the kind, the code and the words", /^\[load\] schema 42703 — column a does not exist$/.test(sent[0]), sent[0]);
  FR.reportFailure("save", { code: "42501", message: "permission denied for table alerts" }, "Couldn't clear it");
  ok("report: a save names what it was", sent[1] === "[save: Couldn't clear it] permission 42501 — permission denied for table alerts", sent[1]);
  FR.reportFailure("save", { code: "P0001", message: "That pack is already picked up." }, "Couldn't cancel");
  FR.reportFailure("load", { message: "Failed to fetch" });
  ok("report: a refusal and a lost signal are not sent", sent.length === 2, sent.length);
  for (let i = 0; i < 10; i++) FR.reportFailure("load", { code: "42703", message: `column c${i} does not exist` });
  ok("report: at most MAX_PER_LOAD a page load", sent.length === FR.MAX_PER_LOAD, sent.length);
  FR.setFailureSender(null);
}

// ── lib/broadcastWindow: the screen keeps the window ──────────────────────────────────────────────────────────────
{
  const at = (iso) => Date.parse(iso);
  const b = { starts_at: "2026-10-16T12:00:00Z", ends_at: "2026-10-16T18:00:00Z" };
  ok("window: before its start a banner is down; in it, up; after its end, down",
    !BW.inWindow(b, at("2026-10-16T11:59:59Z")) && BW.inWindow(b, at("2026-10-16T12:00:00Z")) && BW.inWindow(b, at("2026-10-16T18:00:00Z")) && !BW.inWindow(b, at("2026-10-16T18:00:00.001Z")));
  ok("window: no start and no end is always up", BW.inWindow({ starts_at: null, ends_at: null }, 0));
  ok("window: the screen looks again just after the end", BW.nextEdge([b], at("2026-10-16T13:00:00Z")) === at("2026-10-16T18:00:00Z") + 1);
  ok("window: …and at a start still ahead, the soonest of them", BW.nextEdge([b, { starts_at: "2026-10-16T14:00:00Z", ends_at: null }], at("2026-10-16T13:00:00Z")) === at("2026-10-16T14:00:00Z"));
  ok("window: nothing ahead, nothing to wait for", BW.nextEdge([b], at("2026-10-17T00:00:00Z")) === null && BW.nextEdge([{ starts_at: null, ends_at: null }], 0) === null);
  ok("window: setTimeout's longest wait", BW.LONGEST_WAIT_MS === 2 ** 31 - 1);
}

// ── lib/passBoard snapDue: the board kept when it changed ─────────────────────────────────────────────────────────
{
  const o = (id, status = "new", extra = {}) => ({ id, status, items: ["latte"], created_at: "2026-10-16T12:00:00Z", status_changed_at: "2026-10-16T12:00:00Z", paid: false, ...extra });
  const rows = [o("a"), o("b", "preparing")];
  ok("snap: the first read is kept", P.snapDue(null, rows, 0) === true);
  const last = { rows, at: 0 };
  ok("snap: the same board 15 seconds later is not written again", P.snapDue(last, [o("a"), o("b", "preparing")], 15_000) === false);
  ok("snap: a board that changed is", P.snapDue(last, [o("a", "preparing"), o("b", "preparing")], 15_000) === true
    && P.snapDue(last, [o("a")], 15_000) === true);
  ok("snap: an unchanged board is written again every five minutes, so its time stays near now", P.snapDue(last, rows, P.SNAP_EVERY_MS) === true && P.SNAP_EVERY_MS === 300_000);
}

// ── the Brand Kit's thumbnails ───────────────────────────────────────────────────────────────────────────────────
{
  const A = JSON.parse(readFileSync(join(ROOT, "lib/brandAssets.json"), "utf8"));
  const masters = Object.keys(A.thumbs);
  ok("brand: every master the kit lists has a thumbnail on disk, and the master too",
    masters.length >= 9 && masters.every((m) => existsSync(join(ROOT, "public", m)) && existsSync(join(ROOT, "public", A.thumbs[m]))));
  ok("brand: what the app leaves on the web is masters with thumbnails", A.webOnly.every((u) => u in A.thumbs));
  const seeded = [...readFileSync(join(ROOT, "supabase/migrations/0059_brand_assets_more.sql"), "utf8").matchAll(/'(\/brand\/[^']+)'/g)].map((m) => m[1]);
  ok("brand: every picture the kit was seeded with has a thumbnail", seeded.length > 0 && seeded.every((u) => u in A.thumbs), seeded.filter((u) => !(u in A.thumbs)));
}

console.log(`R13 (shared stores, failure reports, banner windows, the Pass's snapshot, the Brand Kit): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
