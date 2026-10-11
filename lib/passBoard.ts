// THE PASS'S RULES, WRITTEN ONCE (2026-10-11, the KDS program, wave 2).
//
// The Pass was 400 lines inside the crew console's page: its read, its feed, its clock and its rules in one function, so
// none of it could be run by a test — a regular expression could only check that it still said what it said. What the
// board decides lives here now, apart from React and from the network's client (each read takes the client, lib/collect's
// shape, so a test hands it a stand-in): which orders it reads and how many, how one change lands on it, when it next
// changes with the time alone, what its feed says about itself, and which orders are "here". scripts/pass.test.mjs runs
// all of it. The board itself is components/pass (ThePass, Ticket, usePassBoard).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "./db";
import { orderClockFrom, waitingToOpen } from "./ordering";

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

// ── time ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "45s", "8m", "2h" — how long ago `iso` was at `nowMs`. */
export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}
export const ageMin = (iso: string, nowMs: number): number => Math.floor((nowMs - new Date(iso).getTime()) / 60000);
export const ageSev = (min: number): "late" | "warn" | "calm" => (min >= LATE_MIN ? "late" : min >= WARN_MIN ? "warn" : "calm");

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
