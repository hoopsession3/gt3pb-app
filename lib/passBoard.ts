// THE PASS'S RULES, WRITTEN ONCE (2026-10-11, the KDS program, wave 2).
//
// The Pass was 400 lines inside the crew console's page: its read, its feed, its clock and its rules in one function, so
// none of it could be run by a test — a regular expression could only check that it still said what it said. What the
// board decides lives here now, apart from React and from the network's client (each read takes the client, lib/collect's
// shape, so a test hands it a stand-in): which orders it reads and how many, how one change lands on it, when it next
// changes with the time alone, what its feed says about itself, and which orders are "here" — and, at arm's length, which
// lane a ticket is in, what its age says in words, what its drinks read, and what may be recalled. scripts/pass.test.mjs
// runs all of it. The board itself is components/pass (ThePass, Ticket, usePassBoard).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "./db";
import { nameFrom } from "./drinks";
import { orderClockFrom, waitingToOpen, waitingLabel } from "./ordering";

/** Picked-up orders linger this long, for review and recall. */
export const RECENT_MS = 30 * 60_000;
/** At most this many open tickets are read at once — oldest first, as the board shows them. */
export const OPEN_CAP = 300;
/** At most this many picked-up ones, newest first. */
export const DONE_CAP = 100;
/** A ticket's age turns gold at 4 minutes and red — late — at 8. */
export const WARN_MIN = 4;
export const LATE_MIN = 8;

type Status = Order["status"];

// One ticket, one next action; ↩ takes it back a stage, and a picked-up order back to Ready (Recall).
export const NEXT: Record<Status, Status | null> = { new: "preparing", preparing: "ready", ready: "done", done: null, void: null };
export const PREV: Record<Status, Status | null> = { new: null, preparing: "new", ready: "preparing", done: "ready", void: null };
export const ACT_CLASS: Record<string, string> = { new: "go", preparing: "primary", ready: "done" };
/** The three live stages of the pass. Tickets move down as the operator advances them. */
export const STAGES: readonly { key: Status; label: string; action: string }[] = [
  { key: "new", label: "New", action: "Start" },
  { key: "preparing", label: "In progress", action: "Mark ready" },
  { key: "ready", label: "Ready · hand off", action: "Picked up" },
];

/** Identical drinks grouped: "2× RISE" instead of "RISE · RISE", in the order they were first rung. */
export function groupItems(items: readonly string[]): { id: string; qty: number }[] {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return [...m.entries()].map(([id, qty]) => ({ id, qty }));
}

// WHAT A TICKET'S DRINKS SAY (2026-10-11). orders.items is a list of the menu's drink ids — "rise", "rise", "flow" — and
// nothing else: the cart counts drinks (components/AppProvider), the checkout sends one id per cup and refuses any id the
// menu does not have (app/api/checkout: "Unknown item"), and order_items is exploded from the same ids (0231). There is no
// size, milk or note on an order to show. A string that is not a drink id (a row written before 0156 closed the
// client's insert, or a writer still to come) is shown as it is, whole — whatever it carries is on the ticket.
// The name is the Catalog's (2026-10-13, R2 — the Catalog is the menu): the Pass passes AppProvider's nameOf, so a drink
// added or renamed in the Catalog prints as the menu says it; without one, the code list's name, then the id.
/** One line per drink, repeats grouped, in the order first rung: { qty: 2, name: "FLOW" }. */
export function itemLines(items: readonly string[], nameOf: (id: string) => string = (id) => nameFrom(null, id)): { key: string; qty: number; name: string }[] {
  return groupItems(items).map(({ id, qty }) => ({ key: id, qty, name: nameOf(id) }));
}
/** The drinks in one line: "2× RISE · FLOW". */
export const itemsLine = (items: readonly string[], nameOf?: (id: string) => string): string =>
  itemLines(items, nameOf).map((l) => `${l.qty > 1 ? `${l.qty}× ` : ""}${l.name}`).join(" · ");

// ── time ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "45s", "8m", "2h" — how long ago `iso` was at `nowMs`. */
export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}
export const ageMin = (iso: string, nowMs: number): number => Math.floor((nowMs - new Date(iso).getTime()) / 60000);
export const ageSev = (min: number): "late" | "warn" | "calm" => (min >= LATE_MIN ? "late" : min >= WARN_MIN ? "warn" : "calm");

/** A TICKET'S AGE, IN WORDS AND COLOUR (2026-10-11). Placed ahead and waiting on its stop: when it is for ("for 11:00am"),
 *  calm. Otherwise how long since its clock started, gold from 4 minutes and red from 8 — and from 8 the word "late"
 *  beside it, so a late ticket is not told by its colour alone. */
export function ticketAge(o: Pick<Order, "created_at" | "ready_from">, nowMs: number): { text: string; sev: "late" | "warn" | "calm"; late: boolean } {
  if (o.ready_from && waitingToOpen(o, nowMs)) return { text: waitingLabel(o.ready_from, nowMs), sev: "calm", late: false };
  const sev = ageSev(ageMin(orderClockFrom(o), nowMs));
  return { text: ago(orderClockFrom(o), nowMs), sev, late: sev === "late" };
}

/** The guests to step over and reassure: a ticket not yet ready whose clock has started (lib/ordering: placed ahead, it
 *  starts when its stop opens) and has run past the late line. */
export const lateOf = (orders: readonly Order[], nowMs: number): Order[] =>
  orders.filter((o) => o.status !== "done" && o.status !== "ready" && !waitingToOpen(o, nowMs) && ageMin(orderClockFrom(o), nowMs) >= LATE_MIN);

/** The next instant the board changes with the time alone: a ticket placed ahead comes due, or a ticket not yet ready
 *  crosses the late line. Null when nothing on it will. The board's clock strikes then (lib/passClock), and not before. */
export function nextBoardChange(orders: readonly Order[], nowMs: number): number | null {
  let next = Infinity;
  const take = (t: number) => { if (t > nowMs && t < next) next = t; };
  for (const o of orders) {
    if (o.status === "done" || o.status === "void") continue;
    if (o.ready_from) take(Date.parse(o.ready_from));
    if (o.status !== "ready") take(Date.parse(orderClockFrom(o)) + LATE_MIN * 60_000);
  }
  return next === Infinity ? null : next;
}

// ── the board's list ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The board's order: oldest first, by when it came in. */
export const byCreated = (a: Order, b: Order): number => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

/** One change, merged into the board without a read: it keeps a recently picked-up order, and drops a void, a delete and
 *  one picked up more than half an hour ago (the next read would drop those anyway). */
export function mergeRow(prev: readonly Order[], row: Order, removed: boolean, nowMs: number): Order[] {
  const without = prev.filter((o) => o.id !== row.id);
  const isStaleDone = row.status === "done" && !(row.status_changed_at && nowMs - new Date(row.status_changed_at).getTime() < RECENT_MS);
  if (!removed && row.status !== "void" && !isStaleDone) {
    without.push(row);
    without.sort(byCreated);
  }
  return without;
}

/** The same order, field for field (its items too): a read that brings it back unchanged changes nothing. */
export function sameOrder(a: Order, b: Order): boolean {
  const ka = Object.keys(a) as (keyof Order)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const x = a[k], y = b[k];
    if (x === y) return true;
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

/** A READ THAT CHANGES NOTHING DRAWS NOTHING. The board is read again every 15 seconds, and each read used to hand every
 *  ticket a new object — so every ticket was drawn again, changed or not. An order that has not changed keeps the object
 *  it had (its ticket is skipped), and a read that changes nothing hands back the board itself (nothing is drawn). */
export function keepSame(prev: readonly Order[], next: readonly Order[]): Order[] {
  const was = new Map(prev.map((o) => [o.id, o]));
  let same = prev.length === next.length;
  const out = next.map((o, i) => {
    const p = was.get(o.id);
    const kept = p && sameOrder(p, o) ? p : o;
    if (kept !== prev[i]) same = false;
    return kept;
  });
  return same ? (prev as Order[]) : out;
}

// ── what this phone has moved and the database has not yet said back (R11, 2026-10-16 — the 10/10 audit) ──────────────
// The board drew a move the moment it was tapped, and every read replaced the board with the database's rows. So a read
// that left before the write had landed — the 15-second reconcile, a return to the screen, the feed coming back — put the
// ticket back in its old lane; and with no signal, every move parked in the queue jumped back on the first read after the
// signal returned, until the queue had drained. Worse at the window: a collection not yet landed read as unpaid again.
// A move is HELD now, under the queue's own key for it (lib/offline: order_status:<id>, collect_cup:<id>), from the tap
// until the database's row shows it, and every read and every feed row is drawn under the holds. A hold lets go when:
//  · the row shows the move (its status; a collection taken; one taken back);
//  · the row shows a change made after the one the phone was looking at when it tapped, by someone else (another phone,
//    a void) — the database's row is the truth then;
//  · HOLD_MS after its tap, unless its write is still parked in the queue, waiting for signal.
export const HOLD_MS = 45_000;
export type HeldKind = "order_status" | "collect_cup" | "undo_collect";
export type Held = {
  kind: HeldKind;
  id: string;
  /** What this phone drew. */
  patch: Partial<Order>;
  /** order_status: where it was moved to, the statuses it was moved through on the way (an earlier move of this phone's
   *  landing is not news), and the database's status_changed_at when this phone first moved it (undefined: not known —
   *  a hold taken back from the queue after a reload). */
  status?: Status;
  steps?: Status[];
  was?: string | null;
  at: number;
};
export const heldKey = (kind: HeldKind, id: string): string => `${kind}:${id}`;

/** A move held from the tap: a second move of the same ticket before the first is said back keeps the first one's `was`,
 *  and a collection and its undo replace each other. Returns a new map. Pure. */
export function holdMove(held: ReadonlyMap<string, Held>, o: Order, kind: HeldKind, patch: Partial<Order>, nowMs: number): Map<string, Held> {
  const next = new Map(held);
  const key = heldKey(kind, o.id);
  const prior = next.get(key);
  next.delete(key);   // the newest hold of an order is drawn last
  if (kind === "order_status") {
    const status = patch.status as Status;
    next.set(key, {
      kind, id: o.id, patch, status, at: nowMs,
      steps: prior ? [...(prior.steps ?? []), prior.status as Status] : [],
      was: prior ? prior.was : (o.status_changed_at ?? null),
    });
  } else {
    next.delete(heldKey(kind === "collect_cup" ? "undo_collect" : "collect_cup", o.id));
    next.set(key, { kind, id: o.id, patch, at: nowMs });
  }
  return next;
}

/** Has the database's row caught up with this hold? Pure. */
export function caughtUp(row: Order, h: Held): boolean {
  if (h.kind === "collect_cup") return row.collected_at != null || row.status === "void";
  if (h.kind === "undo_collect") return row.collected_at == null;
  if (row.status === h.status) return true;
  if (h.was === undefined) return false;
  return (row.status_changed_at ?? null) !== h.was && !(h.steps ?? []).includes(row.status);
}

/** The database's rows, drawn under this phone's holds: a row not caught up is drawn as this phone moved it (and one this
 *  phone voided is left off, as a voided row always is). Returns the rows and the holds still held — those the rows caught
 *  up with, and those past HOLD_MS with nothing in the queue, are let go. `queued`: the queue's keys. Pure. */
export function underHeld(rows: readonly Order[], held: ReadonlyMap<string, Held>, nowMs: number, queued: ReadonlySet<string>): { rows: Order[]; held: Map<string, Held> } {
  const keep = new Map<string, Held>();
  for (const [k, h] of held) if (nowMs - h.at <= HOLD_MS || queued.has(k)) keep.set(k, h);
  if (!keep.size) return { rows: rows as Order[], held: keep };
  const out: Order[] = [];
  for (const r of rows) {
    let row = r;
    for (const [k, h] of keep) {
      if (h.id !== r.id) continue;
      if (caughtUp(r, h)) { keep.delete(k); continue; }
      row = { ...row, ...h.patch } as Order;
    }
    if (row.status !== "void") out.push(row);
  }
  return { rows: out, held: keep };
}

/** The holds a reload starts from: every move still parked in the queue (what it was moved from is not known then). */
export function heldFromQueue(queue: readonly { kind: string; id: string; value: string; at: number }[]): Map<string, Held> {
  const held = new Map<string, Held>();
  for (const q of queue) {
    if (q.kind === "order_status") held.set(heldKey("order_status", q.id), { kind: "order_status", id: q.id, patch: { status: q.value as Status }, status: q.value as Status, steps: [], was: undefined, at: q.at });
    // The money a phone took with no signal is drawn as taken; the till already holds it.
    else if (q.kind === "collect_cup") held.set(heldKey("collect_cup", q.id), { kind: "collect_cup", id: q.id, patch: { collected_via: q.value, collected_at: new Date(q.at).toISOString(), payment_status: "paid" } as Partial<Order>, at: q.at });
  }
  return held;
}

// ── the ticket that slid under the finger (R11, 2026-10-16 — the 10/10 audit) ─────────────────────────────────────────
// An advance takes its ticket out of the lane in the same frame, and the next ticket's button arrives where the thumb is:
// a bounce on "Picked up" handed off the next order with its drink still on the counter; on "Start", two were started.
// For TAP_SETTLE_MS after a move out of a lane, a tap on another ticket's move in that lane is taken for the same press.
export const TAP_SETTLE_MS = 450;
export type Settle = { lane: string; id: string; until: number } | null;
/** Was this tap the last press, landing on the ticket that took its place? Pure. */
export function bounced(s: Settle, lane: string, id: string, nowMs: number): boolean {
  return !!s && s.lane === lane && s.id !== id && nowMs < s.until;
}

export type BoardRead = { rows: Order[]; more: number; doneMore: boolean; error: { message: string } | null };

/** THE BOARD'S READ, BOUNDED. It read every order not void and not picked up more than half an hour ago, however many
 *  there were — no limit, no age — so a pass left with yesterday's tickets on it read them all, every 15 seconds, and drew
 *  them all. Two reads now, side by side:
 *    · the open tickets (new, in progress, ready), oldest first as the board shows them, at most `cap` of them, with the
 *      count of all of them — so `more` says how many were not read, and the board says so (never an order hidden in
 *      silence). Its filter is 0238's partial index, word for word (status <> 'done' and status <> 'void');
 *    · what was picked up in the last half hour, newest first, at most DONE_CAP (`doneMore`: there were more).
 *  Each row is held to the read it came from, so an answer that sends a row twice draws it once. */
export async function readBoard(sb: SupabaseClient, nowMs: number, cap: number = OPEN_CAP): Promise<BoardRead> {
  const recentISO = new Date(nowMs - RECENT_MS).toISOString();
  const [open, done] = await Promise.all([
    sb.from("orders").select("*", { count: "exact" }).neq("status", "void").neq("status", "done").order("created_at").limit(cap),
    sb.from("orders").select("*").eq("status", "done").gte("status_changed_at", recentISO).order("status_changed_at", { ascending: false }).limit(DONE_CAP + 1),
  ]);
  const error = open.error ?? done.error ?? null;
  if (error) return { rows: [], more: 0, doneMore: false, error };
  const sent = (open.data ?? []) as Order[];
  const openRows = sent.filter((o) => o.status !== "done" && o.status !== "void");
  const ids = new Set(openRows.map((o) => o.id));
  const doneRows = ((done.data ?? []) as Order[]).filter((o) => o.status === "done" && !ids.has(o.id));
  return {
    rows: [...openRows, ...doneRows.slice(0, DONE_CAP)].sort(byCreated),
    more: Math.max(0, (open.count ?? sent.length) - sent.length),
    doneMore: doneRows.length > DONE_CAP,
    error: null,
  };
}

/** The line under the board when the read stopped short: "+12 more open orders". */
export const moreLine = (more: number): string => `+${more} more open order${more === 1 ? "" : "s"}`;

// ── the lanes ────────────────────────────────────────────────────────────────────────────────────────────────────────
// PLACED AHEAD IS NOT NEW (2026-10-11). An order placed ahead of a stop (0343 ready_from) sat in New among the orders to
// make now, by when it was placed — the first ticket on the board at 7am for a stop that opens at 11. It waits in a lane of
// its own now, Scheduled (folded, soonest first, each saying when it is for), and moves to New the moment its stop opens:
// the board's clock strikes then (nextBoardChange). In New the oldest clock is first — a pre-order that just came due sits
// where its stop's opening puts it, not ahead of a guest who has waited since. Live Ops' count reads the same rule
// (readPulse): "N on the pass" is New + In progress + Ready, "N placed ahead" is Scheduled.
/** Still new, and waiting on its stop to open. Started early, it is in progress like any other. */
export const isScheduled = (o: Order, nowMs: number): boolean => o.status === "new" && waitingToOpen(o, nowMs);

export type Lanes = { scheduled: Order[]; new: Order[]; preparing: Order[]; ready: Order[]; done: Order[] };
const byClock = (a: Order, b: Order): number => Date.parse(orderClockFrom(a)) - Date.parse(orderClockFrom(b)) || byCreated(a, b);
export function passLanes(orders: readonly Order[], nowMs: number): Lanes {
  const l: Lanes = { scheduled: [], new: [], preparing: [], ready: [], done: [] };
  for (const o of orders) {
    if (o.status === "new") (isScheduled(o, nowMs) ? l.scheduled : l.new).push(o);
    else if (o.status === "preparing" || o.status === "ready" || o.status === "done") l[o.status].push(o);
  }
  l.scheduled.sort((a, b) => Date.parse(a.ready_from ?? "") - Date.parse(b.ready_from ?? "") || byCreated(a, b));
  l.new.sort(byClock);
  l.preparing.sort(byCreated);
  l.ready.sort(byCreated);
  l.done.sort((a, b) => (a.status_changed_at < b.status_changed_at ? 1 : a.status_changed_at > b.status_changed_at ? -1 : 0));
  return l;
}

/** The lane a ticket is in now — where focus goes back to when the ticket leaves the board (components/pass/focus). */
export const laneOf = (o: Order, nowMs: number): keyof Lanes =>
  isScheduled(o, nowMs) ? "scheduled" : o.status === "void" ? "new" : o.status;

/** A lane's name as a screen reader hears its heading — the words on it, and the count in it: "New, 3 orders". */
const SPOKEN: Record<keyof Lanes, string> = { scheduled: "Scheduled", new: "New", preparing: "In progress", ready: "Ready, hand off", done: "Just completed" };
export const laneName = (lane: keyof Lanes, n: number): string => `${SPOKEN[lane]}, ${n} order${n === 1 ? "" : "s"}`;

// RECALL, ONE TAP FROM THE TICKET (2026-10-11). A picked-up ticket was two taps and a scroll from being brought back: open
// the folded tray at the foot of the board, then Recall. The last few picked up stay in reach under Ready, each with its
// Recall; the rest fold. A recall is the ticket's own move, from the status it showed — done → ready, which
// staff_set_order_status allows (0368: "Recall (done → ready)") — and it never tells the customer "ready" a second time.
/** The picked-up tickets shown before the tray is opened. */
export const TRAY_SHOWN = 3;
/** Picked up in the last half hour: it can be brought back to Ready. */
export const canRecall = (o: Pick<Order, "status" | "status_changed_at">, nowMs: number): boolean =>
  o.status === "done" && !!o.status_changed_at && nowMs - new Date(o.status_changed_at).getTime() < RECENT_MS;

/** LIVE OPS' COUNT, BY THE PASS'S LANES: on the pass (New + In progress + Ready) and placed ahead (Scheduled). It counted an
 *  order placed ahead and started early as neither on the pass nor ahead's equal — it was "ahead" while the Pass showed it
 *  In progress. Two head counts, nothing read. */
export async function readPulse(sb: SupabaseClient, nowMs: number): Promise<{ pass: number | null; ahead: number | null }> {
  const nowISO = new Date(nowMs).toISOString();
  const [o, a] = await Promise.all([
    sb.from("orders").select("id", { count: "exact", head: true }).neq("status", "void").neq("status", "done")
      .or(`status.neq.new,ready_from.is.null,ready_from.lte.${nowISO}`),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "new").gt("ready_from", nowISO),
  ]);
  return { pass: o.error ? null : o.count, ahead: a.error ? null : a.count };
}

// ── what the Pass says out loud ─────────────────────────────────────────────────────────────────────────────────────
// A NEW ORDER IS SAID, POLITELY (2026-10-11). The whole board was one polite live region, so a screen reader was told
// every change on it — each ticket's age, every second. One quiet line says what arrived instead.
export const newOrderWords = (o: Pick<Order, "customer" | "items">, nameOf?: (id: string) => string): string => `New order: ${o.customer ?? "Guest"} — ${itemsLine(o.items, nameOf)}`;
export const newOrdersWords = (n: number): string => `${n} new orders`;
export const outsideWords = (o: Pick<Order, "customer">): string => `${o.customer ?? "Guest"} is outside`;

// ── what the feed says about itself ──────────────────────────────────────────────────────────────────────────────────
/** THE PASS'S FEED, SAID OUT LOUD (2026-10-11). Whenever it changes the Pass tells the rest of the app on PASS_FEED_EVENT
 *  ({ state, at }) — live; reconnecting (the feed dropped, the 15-second read still carries the board); down (the last
 *  read failed); signed-out (a read with no session). */
export type PassFeed = "live" | "reconnecting" | "down" | "signed-out";
export const PASS_FEED_EVENT = "gt3:pass-feed";
export type BoardDown = "" | "net" | "auth" | "read";
export function feedState(down: BoardDown, live: boolean): PassFeed {
  if (down === "auth") return "signed-out";
  if (down) return "down";
  return live ? "live" : "reconnecting";
}

// ── "here": the stop the truck is live at, or the live event ─────────────────────────────────────────────────────────
// An order is stamped where it was sold as it goes in (stamp_order_event, 0024 and 0219): the live event's id, or, with
// no event live, the stop live_status names while the truck is live. The Pass reads the same two facts and can show only
// the orders sold here. An order with neither — placed with nothing live, or placed ahead (0343 gives those no stop) —
// cannot be told apart, so it is always shown. Nothing is live: everything is here.
export type Here = { eventId: string | null; stopId: string | null };
export const NOWHERE: Here = { eventId: null, stopId: null };
export const somewhereLive = (h: Here): boolean => !!(h.eventId || h.stopId);
export function isHere(o: Pick<Order, "event_id" | "stop_id">, h: Here): boolean {
  if (!somewhereLive(h) || (!o.event_id && !o.stop_id)) return true;
  return (!!h.eventId && o.event_id === h.eventId) || (!!h.stopId && o.stop_id === h.stopId);
}

/** Where the truck is selling now, read: the live stop (live_status, while the truck is live) and the live event. */
export async function readHere(sb: SupabaseClient): Promise<{ here: Here; error: { message: string } | null }> {
  const [ls, ev] = await Promise.all([
    sb.from("live_status").select("current_stop_id, is_live").eq("id", 1).maybeSingle(),
    sb.from("events").select("id").eq("is_live", true).limit(1),
  ]);
  const error = ls.error ?? ev.error ?? null;
  if (error) return { here: NOWHERE, error };
  const row = ls.data as { current_stop_id?: string | null; is_live?: boolean | null } | null;
  const live = ((ev.data ?? []) as { id: string }[])[0];
  return { here: { eventId: live?.id ?? null, stopId: row?.is_live ? row.current_stop_id ?? null : null }, error: null };
}

type Change = { eventType?: string; new?: Record<string, unknown> | null; old?: Record<string, unknown> | null };
/** "Here" after one change on the feed — read from the change itself, never a second read: live_status changes every few
 *  seconds while the truck broadcasts where it is (admin_set_truck_pos), and each of those changes nothing here. */
export function hereAfter(h: Here, table: string, p: Change): Here {
  const n = (p.new ?? {}) as { id?: string; is_live?: boolean | null; current_stop_id?: string | null };
  if (table === "live_status") {
    if (p.eventType === "DELETE") return h.stopId ? { ...h, stopId: null } : h;
    const stopId = n.is_live ? n.current_stop_id ?? null : null;
    return stopId === h.stopId ? h : { ...h, stopId };
  }
  if (table === "events") {
    if (p.eventType !== "DELETE" && n.is_live && n.id) return n.id === h.eventId ? h : { ...h, eventId: n.id };
    const id = p.eventType === "DELETE" ? (p.old as { id?: string } | null)?.id : n.id;
    return id && id === h.eventId ? { ...h, eventId: null } : h;
  }
  return h;
}

/** What this phone shows: every order, or the ones sold here (remembered per phone — components/pass/usePassBoard). */
export type Scope = "all" | "here";
export const scopeFrom = (raw: string | null | undefined): Scope => (raw === "here" ? "here" : "all");

/** The line that says what "Here" leaves out, so it is never left out in silence: "3 open orders from elsewhere". */
export const elsewhereLine = (n: number): string => `${n} open order${n === 1 ? "" : "s"} from elsewhere`;
