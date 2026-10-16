// R11 (2026-10-16 — the 10/10 audit's front end): what keeps working when something goes wrong, run.
//
// The rules R11 added are pure modules, and this drives them: the burst coalescer every realtime screen reads through
// (lib/rush), the deadlines every call out of the browser carries (lib/deadline), the Pass remembered through a reload
// (lib/passOpen), the profile and the session a phone keeps for a cold start with no signal (lib/keptProfile), and the
// Pass's held moves and its bounce guard (lib/passBoard). scripts/smoke.cjs holds the wiring (who calls what);
// scripts/sw.test.mjs runs the service worker's half.
import { libLoader } from "./fixtures/chargeonce.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const R = load("lib/rush.ts"), D = load("lib/deadline.ts"), PO = load("lib/passOpen.ts"), KP = load("lib/keptProfile.ts"), P = load("lib/passBoard.ts");
const W = load("lib/accountWipe.ts");

// ── lib/rush: one read for a burst ─────────────────────────────────────────────────────────────────────────────────
{
  // A clock and timers turned by hand.
  let t = 0, seq = 0;
  const timers = new Map();
  const fake = { set: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; }, clear: (id) => { timers.delete(id); } };
  const advance = (ms) => { const end = t + ms; for (;;) { const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; t = due[1].at; timers.delete(due[0]); due[1].fn(); } t = end; };
  let runs = 0;
  const c = R.coalesce(() => { runs++; }, () => t, fake);
  for (let i = 0; i < 15; i++) { c.poke(); advance(10); }
  ok("rush: fifteen changes in a burst wait for the burst", runs === 0, runs);
  advance(R.RUSH_MS);
  ok("rush: …and are one read", runs === 1, runs);
  runs = 0;
  for (let i = 0; i < 40; i++) { c.poke(); advance(100); }   // a steady stream, a change every 100 ms for 4 s
  ok("rush: a steady stream is still read — at least once a second, never once a change", runs >= 3 && runs <= 5, runs);
  runs = 0;
  c.poke(); c.cancel(); advance(5_000);
  ok("rush: a screen that leaves cancels the read it had waiting", runs === 0, runs);
  ok("rush: the numbers", R.RUSH_MS === 300 && R.RUSH_MAX_MS === 1_000);
}

// ── lib/deadline: every call out has one ───────────────────────────────────────────────────────────────────────────
{
  const NET = /fetch|network|load failed|timed? ?out|connection/i;   // components/offline isNetworkError, word for word
  const never = (_u, init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }))); });
  let e = null;
  try { await D.withDeadline(25, never)("https://x.supabase.co/rest/v1/orders", {}); } catch (x) { e = x; }
  ok("deadline: no answer in time is a TypeError…", e instanceof TypeError, e && e.name);
  ok("deadline: …whose words read as no signal (a Pass write that ran out of time is queued, as one with no bars is)",
    !!e && NET.test(e.message) && /timed out/.test(e.message), e && e.message);
  const answered = { ok: true };
  let sawSignal = null;
  const quick = async (_u, init) => { sawSignal = init.signal; return answered; };
  const r = await D.withDeadline(25, quick)("https://x/api/checkout", { method: "POST" });
  await new Promise((res) => setTimeout(res, 60));
  ok("deadline: an answer in time is the answer, and its timer is cleared — the body is not cut off later",
    r === answered && sawSignal && sawSignal.aborted === false, sawSignal && sawSignal.aborted);
  const own = new AbortController();
  let passed = null;
  await D.withDeadline(10, async (_u, init) => { passed = init; return answered; })("https://x/api/y", { signal: own.signal });
  ok("deadline: a caller's own signal is left alone (two can't be joined on an iPhone without AbortSignal.any)", passed && passed.signal === own.signal);
  let refused = null;
  try { await D.withDeadline(1_000, async () => { throw new TypeError("Load failed"); })("https://x/a", {}); } catch (x) { refused = x; }
  ok("deadline: a failure that is not the deadline is passed on as it was", refused && refused.message === "Load failed", refused && refused.message);
  ok("deadline: the database's limit is short, a file's long, an edge function's a route's",
    D.dbDeadlineFor("https://p.supabase.co/rest/v1/rpc/staff_set_order_status") === D.DB_DEADLINE_MS
    && D.dbDeadlineFor("https://p.supabase.co/auth/v1/token?grant_type=refresh_token") === D.DB_DEADLINE_MS
    && D.dbDeadlineFor("https://p.supabase.co/storage/v1/object/photos/a.jpg") === D.FILE_DEADLINE_MS
    && D.dbDeadlineFor("https://p.supabase.co/functions/v1/push") === D.ROUTE_DEADLINE_MS);
  ok("deadline: past the longest a route may run (120 s), and a payment's past two of Square's 20 s calls",
    D.ROUTE_DEADLINE_MS > 120_000 && D.PAY_DEADLINE_MS > 40_000 && D.PAY_DEADLINE_MS < 60_000 && D.DB_DEADLINE_MS >= 8_000);
  let chosen = null;
  try { await D.withDeadline((u) => { chosen = u; return 15; }, never)(new URL("https://p.supabase.co/storage/v1/object/x"), {}); } catch { /* the deadline */ }
  ok("deadline: a limit chosen per request is chosen from its address, however the address was given", chosen === "https://p.supabase.co/storage/v1/object/x", chosen);
}

// ── lib/passOpen: the Pass remembered through a reload ─────────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-10-16T18:00:00Z");
  ok("pass open: open a minute ago — opened again", PO.passStillOpen(String(now - 60_000), now));
  ok("pass open: open two hours ago and not since — not", !PO.passStillOpen(String(now - PO.PASS_REOPEN_MS), now));
  ok("pass open: nothing kept, a word, or a time to come — not", !PO.passStillOpen(null, now) && !PO.passStillOpen("open", now) && !PO.passStillOpen(String(now + 60_000), now));
  ok("pass open: an open Pass says so well inside the window", PO.PASS_OPEN_BEAT_MS * 4 < PO.PASS_REOPEN_MS);
  ok("pass open: signing out takes it off the phone, with the profile kept for a cold start",
    W.accountKeysIn(["gt3-pass-open", "gt3-profile:u1", "gt3-theme"]).join() === "gt3-pass-open,gt3-profile:u1");
}

// ── lib/keptProfile: a cold start with no signal ───────────────────────────────────────────────────────────────────
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); },
    key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
  };
  // Object.keys(localStorage) is how the app lists what a store holds; the stand-in lists the same way.
  const keysOf = () => [...store.keys()];
  globalThis.localStorage = new Proxy(globalThis.localStorage, { ownKeys: () => keysOf(), getOwnPropertyDescriptor: (t, k) => (store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)) });
  const now = Date.now();
  KP.keepProfile("u1", { id: "u1", role: "server" });
  ok("kept: the last profile read is there for the same person", KP.keptProfile("u1")?.role === "server");
  ok("kept: …and for no one else", KP.keptProfile("u2") === null);
  store.set("gt3-profile:u3", JSON.stringify({ at: now - 15 * 86_400_000, profile: { id: "u3" } }));
  ok("kept: one older than two weeks is not used", KP.keptProfile("u3") === null);
  store.set("gt3-profile:u4", JSON.stringify({ at: now, profile: { id: "someone-else" } }));
  ok("kept: one filed under the wrong person is not used", KP.keptProfile("u4") === null);
  ok("kept: no signal is a reason to use it — Safari's words, Chrome's, a deadline's",
    KP.offlineFailure({ message: "TypeError: Load failed", code: "" }) && KP.offlineFailure({ message: "Failed to fetch" })
    && KP.offlineFailure({ message: "TypeError: Network request timed out — no answer in 20 s", code: "" }));
  ok("kept: a refusal is not (a row the rules hide stays hidden)", !KP.offlineFailure({ message: "permission denied for table profiles", code: "42501" }) && !KP.offlineFailure(null));
  ok("stored session: none kept — no one", KP.storedSessionUser() === null);
  store.set("sb-abcdefgh-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u1", email: "crew@gt3pb.com" } }));
  ok("stored session: the person a kept session is for", KP.storedSessionUser()?.id === "u1");
  store.set("sb-abcdefgh-auth-token", JSON.stringify({ access_token: "a", refresh_token: "", user: { id: "u1" } }));
  ok("stored session: one with nothing to renew with is no one's", KP.storedSessionUser() === null);
  store.set("sb-abcdefgh-auth-token", "{not json");
  ok("stored session: a broken one is no one's, and does not throw", KP.storedSessionUser() === null);
  delete globalThis.localStorage;
}

// ── lib/passBoard: held moves ──────────────────────────────────────────────────────────────────────────────────────
{
  const T = Date.parse("2026-10-16T18:00:00Z");
  const S0 = "2026-10-16T17:55:00.000Z";
  const o = (x = {}) => ({ id: "o1", status: "new", status_changed_at: S0, created_at: S0, collected_at: null, collected_via: null, paid: false, payment_status: "pending", total_cents: 600, items: ["rise"], ...x });
  const none = new Set();
  let held = P.holdMove(new Map(), o(), "order_status", { status: "preparing", status_changed_at: "2026-10-16T18:00:00.100Z" }, T);
  let r = P.underHeld([o()], held, T + 5_000, none);
  ok("held: a read that left before the write landed draws the ticket where it was moved, not back in New",
    r.rows[0].status === "preparing" && r.held.size === 1, r.rows[0].status);
  r = P.underHeld([o({ status: "preparing", status_changed_at: "2026-10-16T18:00:01.000Z" })], held, T + 6_000, none);
  ok("held: the database's row showing the move lets go — its row is drawn", r.rows[0].status_changed_at === "2026-10-16T18:00:01.000Z" && r.held.size === 0);
  r = P.underHeld([o({ status: "void", status_changed_at: "2026-10-16T18:00:02.000Z" })], held, T + 6_000, none);
  ok("held: another phone's change after the tap is the truth — let go (a void leaves the board)", r.rows.length === 0 && r.held.size === 0);
  // two moves before the first is said back
  held = P.holdMove(held, o({ status: "preparing", status_changed_at: "2026-10-16T18:00:00.100Z" }), "order_status", { status: "ready", status_changed_at: "2026-10-16T18:00:00.900Z" }, T + 800);
  r = P.underHeld([o({ status: "preparing", status_changed_at: "2026-10-16T18:00:01.000Z" })], held, T + 2_000, none);
  ok("held: two quick moves — the first landing is not news, the ticket stays where the second put it", r.rows[0].status === "ready" && r.held.size === 1, r.rows[0].status);
  r = P.underHeld([o()], held, T + 2_000, none);
  ok("held: …and a read from before either still draws the second", r.rows[0].status === "ready");
  r = P.underHeld([o()], held, T + 800 + P.HOLD_MS + 1, none);
  ok("held: a hold no row ever confirmed lets go after HOLD_MS — the board is the database's again", r.rows[0].status === "new" && r.held.size === 0);
  const queued = new Set(["order_status:o1"]);
  r = P.underHeld([o()], held, T + 10 * 60_000, queued);
  ok("held: a move waiting in the queue for signal is held for as long as it waits", r.rows[0].status === "ready" && r.held.size === 1);
  // money at the window
  let money = P.holdMove(new Map(), o({ status: "ready" }), "collect_cup", { collected_via: "cash", collected_at: "2026-10-16T18:00:00.000Z", paid: true, payment_status: "paid" }, T);
  r = P.underHeld([o({ status: "ready" })], money, T + 3_000, none);
  ok("held: cash taken at the window is not read back to unpaid before it lands", r.rows[0].collected_via === "cash" && r.rows[0].paid === true);
  r = P.underHeld([o({ status: "ready", collected_at: "2026-10-16T18:00:01.000Z", collected_via: "cash", paid: true })], money, T + 3_000, none);
  ok("held: …and lets go once the database has it", r.held.size === 0);
  money = P.holdMove(money, o({ status: "ready" }), "undo_collect", { collected_via: null, collected_at: null, paid: false, payment_status: "pending" }, T + 4_000);
  ok("held: an undo replaces the collection it takes back", money.size === 1 && [...money.keys()][0] === "undo_collect:o1");
  r = P.underHeld([o({ status: "ready", collected_at: "2026-10-16T18:00:01.000Z", collected_via: "cash", paid: true })], money, T + 5_000, none);
  ok("held: …and is drawn unpaid until the database's row is", r.rows[0].collected_at === null && r.rows[0].paid === false);
  // a void held
  const voided = P.holdMove(new Map(), o({ status: "ready" }), "order_status", { status: "void" }, T);
  ok("held: an order this phone voided is left off a read that still has it", P.underHeld([o({ status: "ready" }), o({ id: "o2" })], voided, T + 1_000, none).rows.map((x) => x.id).join() === "o2");
  // after a reload
  const fromQ = P.heldFromQueue([{ key: "order_status:o1", kind: "order_status", id: "o1", value: "done", at: T }, { key: "collect_cup:o2", kind: "collect_cup", id: "o2", value: "card_reader", at: T }]);
  r = P.underHeld([o({ status: "ready" }), o({ id: "o2", status: "ready" })], fromQ, T + 60 * 60_000, new Set(["order_status:o1", "collect_cup:o2"]));
  ok("held: after a reload, the moves still queued are drawn from the queue", r.rows[0].status === "done" && r.rows[1].collected_via === "card_reader", r.rows.map((x) => [x.status, x.collected_via]));
  r = P.underHeld([o({ status: "preparing", status_changed_at: "2026-10-16T18:30:00.000Z" })], fromQ, T + 60 * 60_000, new Set(["order_status:o1"]));
  ok("held: …where what it was moved from is not known, only the move itself, or the queue sending it, lets go", r.rows[0].status === "done");
  ok("held: no holds, nothing drawn differently", P.underHeld([o()], new Map(), T, none).rows[0] !== undefined && P.underHeld([o()], new Map(), T, none).rows[0].status === "new");
}

// ── lib/passBoard: the ticket that slid under the finger ───────────────────────────────────────────────────────────
{
  const T = 1_000_000;
  const s = { lane: "ready", id: "o1", until: T + P.TAP_SETTLE_MS };
  ok("bounce: a second tap in the lane just left, on the ticket that took its place, is the same press", P.bounced(s, "ready", "o2", T + 120));
  ok("bounce: the same ticket again is not (its own button moved with it)", !P.bounced(s, "ready", "o1", T + 120));
  ok("bounce: another lane is not", !P.bounced(s, "new", "o2", T + 120));
  ok("bounce: after the moment, a tap is a tap", !P.bounced(s, "ready", "o2", T + P.TAP_SETTLE_MS));
  ok("bounce: nothing moved yet — nothing to bounce off", !P.bounced(null, "ready", "o2", T));
  ok("bounce: under half a second", P.TAP_SETTLE_MS >= 300 && P.TAP_SETTLE_MS <= 600);
}

console.log(`R11: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
