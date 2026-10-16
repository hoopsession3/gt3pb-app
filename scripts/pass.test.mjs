// THE PASS, RUN (2026-10-11, the KDS program, wave 2).
//
// The Pass's rules were inside a 6,500-line page, where a test could only match their spelling. They are lib/passBoard
// and lib/passClock now, and this runs them: the bounded read against a stand-in that applies the filters the read sends
// (scripts/fixtures/postgrest.mjs — a wrong filter is a wrong answer, not a query that looks right), how one change lands
// on the board, how a read that changes nothing draws nothing, the board's clock that strikes only when the board changes,
// what the feed says about itself, and "here". scripts/smoke.cjs holds the wiring (components/pass).
//
// What is real is compiled from lib/ (passBoard, passClock, ordering, dates, road, menu). The clock is Eastern, as the
// truck's is; the timer is a fake one this file turns by hand.
process.env.TZ = "America/New_York";
import { libLoader } from "./fixtures/chargeonce.mjs";
import { fakeDb } from "./fixtures/postgrest.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const P = load("lib/passBoard.ts"), K = load("lib/passClock.ts"), O = load("lib/ordering.ts");
ok("compiled: lib/passBoard, lib/passClock", typeof P.readBoard === "function" && typeof K.strikeClock === "function");

const T0 = Date.parse("2026-10-11T15:00:00.000Z");    // Sunday 11:00am ET
const MIN = 60_000;
const at = (m) => new Date(T0 + m * MIN).toISOString();
let seq = 0;
const order = (o = {}) => {
  const id = o.id ?? `0000${(++seq).toString(16)}`.slice(-4) + "e000-0000-4000-8000-000000000000";
  return { id, user_id: null, customer: "Guest", items: ["rise"], total_cents: 1000, paid: true, payment_id: "pay_1", status: "new",
    created_at: at(-5), status_changed_at: at(-5), ready_from: null, event_id: null, stop_id: null, ...o };
};

// ── the stages ──────────────────────────────────────────────────────────────────────────────────────────────────────
ok("one next action per stage, and Picked up goes back to Ready (Recall)",
  P.NEXT.new === "preparing" && P.NEXT.preparing === "ready" && P.NEXT.ready === "done" && P.NEXT.done === null && P.NEXT.void === null
  && P.PREV.done === "ready" && P.PREV.ready === "preparing" && P.PREV.preparing === "new" && P.PREV.new === null && P.PREV.void === null);
ok("the three live stages, in the order a ticket walks them",
  P.STAGES.map((s) => `${s.key}:${s.label}:${s.action}`).join("|") === "new:New:Start|preparing:In progress:Mark ready|ready:Ready · hand off:Picked up");
ok("repeats grouped in the order first rung: RISE, FLOW, RISE → 2× RISE, FLOW",
  JSON.stringify(P.groupItems(["rise", "flow", "rise"])) === JSON.stringify([{ id: "rise", qty: 2 }, { id: "flow", qty: 1 }]));

// ── time ────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok("ages read 45s, 8m, 2h", P.ago(at(0), T0 + 45_000) === "45s" && P.ago(at(0), T0 + 8 * MIN + 30_000) === "8m" && P.ago(at(0), T0 + 125 * MIN) === "2h");
ok("an age never reads negative (a clock a little ahead of this phone's)", P.ago(at(1), T0) === "0s");
ok("calm under 4 minutes, warn from 4, late from 8",
  P.ageSev(3) === "calm" && P.ageSev(4) === "warn" && P.ageSev(7) === "warn" && P.ageSev(8) === "late" && P.ageSev(90) === "late");
{
  const rows = [
    order({ id: "a", created_at: at(-9) }),                                          // new, 9m: late
    order({ id: "b", created_at: at(-7) }),                                          // 7m: not yet
    order({ id: "c", created_at: at(-20), status: "ready" }),                        // ready: the guest is not waiting on us
    order({ id: "d", created_at: at(-120), ready_from: at(30) }),                    // placed ahead, its stop not open
    order({ id: "e", created_at: at(-120), ready_from: at(-9) }),                    // placed ahead, open 9m: late
    order({ id: "f", created_at: at(-120), ready_from: at(-3), status: "preparing" }), // open 3m: not yet
    order({ id: "g", created_at: at(-40), status: "done" }),
  ];
  const late = P.lateOf(rows, T0).map((o) => o.id).join("");
  ok("late: a ticket not ready whose clock started 8+ minutes ago — a pre-order's clock starts when its stop opens", late === "ae", late);
  const next = P.nextBoardChange(rows, T0);
  ok("the board next changes when the 7-minute ticket turns late (in 1 minute), not every second", next === T0 + MIN, next && new Date(next).toISOString());
  ok("…then when the placed-ahead ticket comes due (its stop opens in 30 minutes)", P.nextBoardChange(rows, T0 + MIN) === T0 + 5 * MIN
    && P.nextBoardChange(rows, T0 + 5 * MIN) === T0 + 30 * MIN, [P.nextBoardChange(rows, T0 + MIN), P.nextBoardChange(rows, T0 + 5 * MIN)]);
  ok("nothing left to change with the time: no strike at all", P.nextBoardChange([order({ status: "ready" }), order({ status: "done" })], T0) === null);
}

// ── one change, landing on the board ────────────────────────────────────────────────────────────────────────────────
{
  const a = order({ id: "a", created_at: at(-5) }), b = order({ id: "b", created_at: at(-3) });
  const board = [a, b];
  const moved = P.mergeRow(board, { ...a, status: "preparing" }, false, T0);
  ok("a change replaces its order and keeps the board oldest first", moved.map((o) => `${o.id}:${o.status}`).join() === "a:preparing,b:new");
  const early = order({ id: "z", created_at: at(-10) });
  ok("a new order lands in its place by when it came in", P.mergeRow(board, early, false, T0).map((o) => o.id).join("") === "zab");
  ok("a void leaves the board", P.mergeRow(board, { ...a, status: "void" }, false, T0).map((o) => o.id).join("") === "b");
  ok("a delete leaves the board", P.mergeRow(board, a, true, T0).map((o) => o.id).join("") === "b");
  ok("picked up a minute ago: it stays, for recall", P.mergeRow(board, { ...a, status: "done", status_changed_at: at(-1) }, false, T0).length === 2);
  ok("picked up 31 minutes ago (a late echo): it leaves", P.mergeRow(board, { ...a, status: "done", status_changed_at: at(-31) }, false, T0).length === 1);
}

// ── a read that changes nothing draws nothing ───────────────────────────────────────────────────────────────────────
{
  const a = order({ id: "a", items: ["rise", "flow"] }), b = order({ id: "b" });
  const prev = [a, b];
  const again = [{ ...a, items: [...a.items] }, { ...b }];
  ok("the same orders read again: the board itself comes back (nothing is drawn)", P.keepSame(prev, again) === prev);
  const changed = [{ ...a, items: [...a.items] }, { ...b, status: "preparing" }];
  const out = P.keepSame(prev, changed);
  ok("one order changed: a new board, the unchanged order keeps its object (its ticket is skipped), the changed one is new",
    out !== prev && out[0] === a && out[1] !== b && out[1].status === "preparing");
  ok("an order that left: a new board without it", P.keepSame(prev, [{ ...a }]).length === 1 && P.keepSame(prev, [{ ...a }])[0] === a);
  ok("items compared item by item", P.sameOrder(a, { ...a, items: ["rise", "flow"] }) && !P.sameOrder(a, { ...a, items: ["flow", "rise"] }));
  ok("a field that came or went is a change (0341's money columns arriving)", !P.sameOrder(b, { ...b, collected_at: null }));
}

// ── the bounded read ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const open = Array.from({ length: 7 }, (_, i) => order({ id: `open-${i}`, created_at: at(-60 + i), status: i % 3 === 0 ? "new" : i % 3 === 1 ? "preparing" : "ready" }));
  const done = [
    order({ id: "done-1", status: "done", status_changed_at: at(-2), created_at: at(-30) }),
    order({ id: "done-2", status: "done", status_changed_at: at(-29), created_at: at(-50) }),
    order({ id: "done-old", status: "done", status_changed_at: at(-31), created_at: at(-50) }),
  ];
  const voided = order({ id: "void-1", status: "void", created_at: at(-1) });
  const db = fakeDb({ orders: [...open, ...done, voided] });
  const r = await P.readBoard(db, T0, 5);
  // THE NEWEST, PAST THE CAP (R13 — the 10/10 audit, F15): read oldest first, the orders just placed were the ones left out,
  // and the reconcile took back the one the feed had just put up. The two left out now are the oldest.
  ok("open tickets: the newest 5 of 7, and `more` says the 2 oldest were not read", r.rows.filter((o) => o.status !== "done").map((o) => o.id).join() === "open-2,open-3,open-4,open-5,open-6" && r.more === 2, r);
  ok("picked up in the last half hour only — the 31-minute one is not read", r.rows.filter((o) => o.status === "done").map((o) => o.id).sort().join() === "done-1,done-2");
  ok("a void is never read", !r.rows.some((o) => o.status === "void"));
  ok("the board comes back oldest first, done ones in their place", r.rows.map((o) => o.created_at).every((c, i, a) => i === 0 || a[i - 1] <= c));
  ok("nothing left out: more is 0 and the line is not needed", (await P.readBoard(db, T0, 300)).more === 0);
  const [o1, d1] = db.calls.slice(0, 2);
  const sh = (c) => c.ops.map((x) => JSON.stringify(x)).join(" ");
  ok("the open read is 0238's partial index word for word (status <> 'void' and <> 'done'), counted, newest first, capped",
    o1.table === "orders" && sh(o1) === '["select","*",{"count":"exact"}] ["neq","status","void"] ["neq","status","done"] ["order","created_at",{"ascending":false}] ["limit",5]', sh(o1));
  ok("the picked-up read: done in the last 30 minutes, newest first, capped one past DONE_CAP (to know there were more)",
    sh(d1) === `["select","*",{}] ["eq","status","done"] ["gte","status_changed_at","${at(-30)}"] ["order","status_changed_at",{"ascending":false}] ["limit",${P.DONE_CAP + 1}]`, sh(d1));
  ok("the caps: 300 open, 100 picked up", P.OPEN_CAP === 300 && P.DONE_CAP === 100);
  // An answer that sends a row twice, or a row in the wrong read — a stand-in that ignores filters, a replica behind — draws it once.
  const loose = { from: () => ({ select() { return this; }, neq() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
    then(res) { return Promise.resolve({ data: [open[0], done[0]], error: null, count: 2 }).then(res); } }) };
  const lr = await P.readBoard(loose, T0);
  ok("a row sent by both reads, or by the wrong one, is drawn once and only where its status says", lr.rows.map((o) => o.id).join() === "open-0,done-1" && lr.more === 0, lr.rows.map((o) => o.id));
  db.fail.orders = "TypeError: Load failed";
  const bad = await P.readBoard(db, T0);
  ok("a failed read says so, with no board (the Pass keeps the one it has)", bad.error?.message === "TypeError: Load failed" && bad.rows.length === 0);
  const many = fakeDb({ orders: Array.from({ length: 103 }, (_, i) => order({ id: `d${i}`, status: "done", status_changed_at: at(-i / 10) })) });
  const mr = await P.readBoard(many, T0);
  ok("more than 100 picked up in half an hour: the newest 100, and doneMore says there were more", mr.rows.length === 100 && mr.doneMore === true && mr.rows.some((o) => o.id === "d0") && !mr.rows.some((o) => o.id === "d102"));
  ok("the line for what was not read", P.moreLine(1) === "+1 more open order" && P.moreLine(12) === "+12 more open orders");
}

// ── what the feed says about itself ─────────────────────────────────────────────────────────────────────────────────
ok("feed: live; reconnecting while the realtime feed is down and reads land; down when a read fails; signed-out with no session",
  P.feedState("", true) === "live" && P.feedState("", false) === "reconnecting" && P.feedState("net", true) === "down"
  && P.feedState("read", false) === "down" && P.feedState("auth", true) === "signed-out" && P.feedState("auth", false) === "signed-out");
ok("feed: the event's name", P.PASS_FEED_EVENT === "gt3:pass-feed");

// ── here ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const H = { eventId: null, stopId: "stop-b" };
  const atB = order({ stop_id: "stop-b" }), atA = order({ stop_id: "stop-a" }), ahead = order({ ready_from: at(60) }), ev = order({ event_id: "ev-1" });
  ok("here, live at stop B: B's orders, and every order with no stop or event (a pre-order has none — 0343)", P.isHere(atB, H) && P.isHere(ahead, H));
  ok("…not stop A's (this morning's, left on the board), not an event's", !P.isHere(atA, H) && !P.isHere(ev, H));
  ok("an event live: its orders are here", P.isHere(ev, { eventId: "ev-1", stopId: null }) && !P.isHere(atB, { eventId: "ev-1", stopId: null }));
  ok("both live: either is here (an order is stamped with the event when one is live — 0219)", P.isHere(ev, { eventId: "ev-1", stopId: "stop-b" }) && P.isHere(atB, { eventId: "ev-1", stopId: "stop-b" }));
  ok("nothing live: everything is here", P.isHere(atA, P.NOWHERE) && P.isHere(ev, P.NOWHERE) && !P.somewhereLive(P.NOWHERE) && P.somewhereLive(H));
  const gps = P.hereAfter(H, "live_status", { eventType: "UPDATE", new: { id: 1, is_live: true, current_stop_id: "stop-b", truck_lat: 34.85, truck_lng: -82.39 } });
  ok("the truck's position moving (a live_status update every few seconds) changes nothing — the same object", gps === H);
  ok("the truck goes offline: no stop", P.hereAfter(H, "live_status", { eventType: "UPDATE", new: { id: 1, is_live: false, current_stop_id: "stop-b" } }).stopId === null);
  ok("the truck goes live at stop C", P.hereAfter(P.NOWHERE, "live_status", { eventType: "UPDATE", new: { id: 1, is_live: true, current_stop_id: "stop-c" } }).stopId === "stop-c");
  const evLive = P.hereAfter(P.NOWHERE, "events", { eventType: "UPDATE", new: { id: "ev-2", is_live: true } });
  ok("an event goes live", evLive.eventId === "ev-2");
  ok("another event edited: nothing changes", P.hereAfter(evLive, "events", { eventType: "UPDATE", new: { id: "ev-3", is_live: false } }) === evLive);
  ok("the live event stops being live", P.hereAfter(evLive, "events", { eventType: "UPDATE", new: { id: "ev-2", is_live: false } }).eventId === null);
  ok("the live event deleted (a delete carries only its id)", P.hereAfter(evLive, "events", { eventType: "DELETE", old: { id: "ev-2" } }).eventId === null);
  const db = fakeDb({ live_status: [{ id: 1, is_live: true, current_stop_id: "stop-b" }], events: [{ id: "ev-1", is_live: false }, { id: "ev-9", is_live: true }] });
  const r = await P.readHere(db);
  ok("read: the live stop from live_status, the live event from events", r.error === null && r.here.stopId === "stop-b" && r.here.eventId === "ev-9", r);
  const off = await P.readHere(fakeDb({ live_status: [{ id: 1, is_live: false, current_stop_id: "stop-b" }], events: [] }));
  ok("read: a stop named while the truck is not live is not here (the stamp reads it only while live — 0219)", off.here.stopId === null && off.here.eventId === null);
  const failing = fakeDb({ live_status: [], events: [] }); failing.fail.events = "boom";
  ok("read: a failed read says so (the Pass keeps what it had)", (await P.readHere(failing)).error?.message === "boom");
  ok("the phone's choice: 'here' or everything (anything else, or nothing kept, is everything)",
    P.scopeFrom("here") === "here" && P.scopeFrom("all") === "all" && P.scopeFrom(null) === "all" && P.scopeFrom("x") === "all");
  ok("the line for what Here leaves out", P.elsewhereLine(1) === "1 open order from elsewhere" && P.elsewhereLine(3) === "3 open orders from elsewhere");
}

// ── the clock ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  // A fake timer and a fake now, turned by hand.
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval, realNow = Date.now;
  const timers = new Map(); let tid = 0, now = T0 + 300;
  globalThis.setInterval = (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; };
  globalThis.clearInterval = (id) => { timers.delete(id); };
  Date.now = () => now;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000; for (const t of [...timers.values()]) t.fn(); } };
  try {
    ok("nothing listening: no timer runs, and the second is the true one", !K.ticking() && timers.size === 0 && K.second() === T0);
    let a = 0, b = 0;
    const offA = K.onSecond(() => a++), offB = K.onSecond(() => b++);
    ok("listeners share ONE timer, at one second", timers.size === 1 && [...timers.values()][0].ms === 1000 && K.ticking());
    now += 600;   // inside the same second: the label's second has not moved
    ok("inside a second, the second a label reads does not move (however often it is asked)", K.second() === T0);
    tick();
    ok("each tick reaches every listener and moves the second", a === 1 && b === 1 && K.second() === T0 + 1000, { a, b, s: K.second() });
    offA();
    tick();
    ok("an unsubscribed listener hears nothing more", a === 1 && b === 2);
    offB();
    ok("the last listener gone: the timer stops", timers.size === 0 && !K.ticking());

    now = T0;
    const clock = K.strikeClock(() => now);
    let struck = 0;
    const off = clock.subscribe(() => struck++);
    ok("the board's clock starts at now", clock.get() === T0);
    tick(5);
    ok("not aimed: it never strikes, however many seconds pass (the board is not drawn by the time)", struck === 0 && clock.get() === T0);
    const due = now + 8 * 1000;
    clock.aim(due);
    tick(7);
    ok("aimed at 8 seconds on: still nothing at 7", struck === 0);
    tick(1);
    ok("…and one strike on the second it is due, carrying that instant", struck === 1 && clock.get() === due, { struck, at: clock.get(), due });
    tick(10);
    ok("once struck it waits to be aimed again — one strike, not one a second", struck === 1);
    clock.aim(T0 - 1);   // an instant already past (a new order whose stop opened before the board's last strike)
    tick(1);
    ok("aimed at an instant already past: it strikes on the next second", struck === 2);
    clock.aim(null);
    tick(3);
    ok("aimed at nothing: no strike", struck === 2);
    off();
    ok("the board's clock rides the one shared timer, and lets it go", timers.size === 0);
  } finally {
    globalThis.setInterval = realSet; globalThis.clearInterval = realClear; Date.now = realNow;
  }
}

// ── the ticket's clock is lib/ordering's ────────────────────────────────────────────────────────────────────────────
ok("a placed-ahead ticket is aged from its stop's opening (lib/ordering orderClockFrom), as late counts it",
  O.orderClockFrom(order({ created_at: at(-120), ready_from: at(-9) })) === at(-9) && P.lateOf([order({ created_at: at(-120), ready_from: at(-9) })], T0).length === 1);

// ── at arm's length: the drinks ─────────────────────────────────────────────────────────────────────────────────────
{
  const lines = P.itemLines(["flow", "rise", "flow", "maple"]);
  ok("a line per drink, repeats grouped, in the order first rung, by the menu's name",
    JSON.stringify(lines.map((l) => [l.qty, l.name])) === JSON.stringify([[2, "FLOW"], [1, "RISE"], [1, "SALTED MAPLE LATTE"]]), lines);
  ok("one line on a phone: 2× FLOW · RISE · SALTED MAPLE LATTE", P.itemsLine(["flow", "rise", "flow", "maple"]) === "2× FLOW · RISE · SALTED MAPLE LATTE");
  ok("a string that is not a drink id is shown whole — whatever it carries is on the ticket",
    P.itemsLine(["flow (oat milk)", "flow (oat milk)", "flow"]) === "2× flow (oat milk) · FLOW");
  ok("no drinks, no line", P.itemsLine([]) === "" && P.itemLines([]).length === 0);
}

// ── at arm's length: a ticket's age, in words ───────────────────────────────────────────────────────────────────────
{
  const w = P.ticketAge(order({ created_at: at(-120), ready_from: at(30) }), T0);
  ok("placed ahead and waiting: when it is for, calm, not late", w.text === "for 11:30am" && w.sev === "calm" && w.late === false, w);
  const l = P.ticketAge(order({ created_at: at(-9) }), T0);
  ok("9 minutes: 9m, red, and the word 'late' — not told by its colour alone", l.text === "9m" && l.sev === "late" && l.late === true, l);
  const g = P.ticketAge(order({ created_at: at(-5) }), T0);
  ok("5 minutes: gold, not yet late", g.text === "5m" && g.sev === "warn" && g.late === false, g);
  const d = P.ticketAge(order({ created_at: at(-120), ready_from: at(-2) }), T0);
  ok("its stop opened 2 minutes ago: aged from the opening", d.text === "2m" && d.sev === "calm", d);
}

// ── the lanes: placed ahead is not new ──────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    order({ id: "walkup", created_at: at(-10) }),                                            // 10:50, made now
    order({ id: "due", created_at: at(-240), ready_from: at(-5) }),                           // placed 7am for 10:55: due
    order({ id: "later", created_at: at(-200), ready_from: at(90) }),                         // for 12:30
    order({ id: "sooner", created_at: at(-100), ready_from: at(30) }),                        // for 11:30
    order({ id: "early", created_at: at(-60), ready_from: at(30), status: "preparing" }),     // for 11:30, started early
    order({ id: "making", created_at: at(-8), status: "preparing" }),
    order({ id: "up", created_at: at(-12), status: "ready" }),
    order({ id: "gone1", status: "done", status_changed_at: at(-20) }),
    order({ id: "gone2", status: "done", status_changed_at: at(-2) }),
  ];
  const L = P.passLanes(rows, T0);
  const ids = (k) => L[k].map((o) => o.id).join(",");
  ok("Scheduled: still new and waiting on its stop, soonest first", ids("scheduled") === "sooner,later", ids("scheduled"));
  ok("New: oldest clock first — a pre-order that came due sits by its stop's opening, after the guest waiting since 10:50",
    ids("new") === "walkup,due", ids("new"));
  ok("started early, a placed-ahead order is in progress like any other", ids("preparing") === "early,making", ids("preparing"));
  ok("Ready and Just completed (newest first)", ids("ready") === "up" && ids("done") === "gone2,gone1", [ids("ready"), ids("done")]);
  const at1130 = P.passLanes(rows, T0 + 30 * MIN);
  ok("the moment its stop opens it moves to New — and the board's clock strikes then",
    at1130.scheduled.map((o) => o.id).join() === "later" && at1130.new.some((o) => o.id === "sooner")
    && P.nextBoardChange(rows.filter((o) => o.id === "sooner"), T0) === T0 + 30 * MIN);
  ok("a pre-order not yet due is never late (the banner counts only started clocks)", P.lateOf(L.scheduled, T0).length === 0);
  ok("the lane a ticket is in, for focus to fall back to",
    P.laneOf(rows[2], T0) === "scheduled" && P.laneOf(rows[0], T0) === "new" && P.laneOf(rows[4], T0) === "preparing" && P.laneOf(rows[7], T0) === "done");
  ok("a heading says its count: 'New, 3 orders', 'In progress, 1 order' — with its own words (Ready, hand off)",
    P.laneName("new", 3) === "New, 3 orders" && P.laneName("preparing", 1) === "In progress, 1 order" && P.laneName("ready", 2) === "Ready, hand off, 2 orders"
    && P.laneName("scheduled", 0) === "Scheduled, 0 orders" && P.laneName("done", 4) === "Just completed, 4 orders");

  // Live Ops' count reads the same rule, through the database's filters.
  const edge = [...rows,
    order({ id: "atnow", created_at: at(-30), ready_from: at(0) }),                            // due this very instant: on the pass
    order({ id: "void", status: "void", ready_from: at(30) }),
    order({ id: "oldpre", created_at: at(-300), ready_from: at(-200), status: "ready" }),
  ];
  const E = P.passLanes(edge, T0);
  const pulse = await P.readPulse(fakeDb({ orders: edge }), T0);
  ok("Live Ops' count is the Pass's lanes: on the pass = New + In progress + Ready, placed ahead = Scheduled",
    pulse.pass === E.new.length + E.preparing.length + E.ready.length && pulse.ahead === E.scheduled.length && pulse.ahead === 2 && pulse.pass === 7,
    { pulse, lanes: { s: E.scheduled.length, n: E.new.length, p: E.preparing.length, r: E.ready.length } });
  const failing = fakeDb({ orders: edge }); failing.fail.orders = "boom";
  const pf = await P.readPulse(failing, T0);
  ok("a count that fails is no count (the button keeps the last one)", pf.pass === null || pf.ahead === null);
}

// ── recall, one tap from the ticket ─────────────────────────────────────────────────────────────────────────────────
ok("picked up 29 minutes ago: it can be recalled; 31 minutes ago, it has left the tray", P.canRecall(order({ status: "done", status_changed_at: at(-29) }), T0)
  && !P.canRecall(order({ status: "done", status_changed_at: at(-31) }), T0));
ok("only a picked-up order is recalled (↩ on a live ticket is a stage back)", !P.canRecall(order({ status: "ready", status_changed_at: at(-1) }), T0));
ok("Recall goes to Ready, from Picked up — the move 0368 allows", P.PREV.done === "ready" && P.TRAY_SHOWN === 3);

// ── what the Pass says out loud ─────────────────────────────────────────────────────────────────────────────────────
ok("a new order, said: name and drinks", P.newOrderWords(order({ customer: "Jess", items: ["rise", "rise", "flow"] })) === "New order: Jess — 2× RISE · FLOW");
ok("several at once, said once", P.newOrdersWords(3) === "3 new orders");
ok("a guest at the window, said", P.outsideWords(order({ customer: null })) === "Guest is outside");

console.log(`THE PASS (lib/passBoard, lib/passClock): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
