// OFFLINE QUEUE — pure list math for the crew console's offline write queue (audit #9: "the KDS
// dies with the signal"). Food trucks work festivals and parking lots with no bars; the moments
// the pass is busiest are exactly the moments connectivity drops. Writes made offline are queued
// here and replayed on reconnect. Pure + deterministic on purpose (unit-tested in smoke); the
// localStorage machinery lives in components/offline.ts, the replay in components/offlineReplay.ts.

export type OfflineOp = {
  key: string;      // coalescing identity, e.g. "order_status:<orderId>"
  kind: "order_status" | "collect_cup";
  id: string;       // target row id
  value: string;    // order_status: the status to set · collect_cup: how it was paid (lib/collect)
  at: number;       // when the human did it (ms) — display + staleness
  from?: string;    // order_status: what the operator's screen showed when they tapped — sent as p_from (lib/orderStatus)
  by?: string | null;   // who made it (R10b): replayed only while they are the one signed in — never under someone else
};

export const orderStatusOp = (orderId: string, status: string, at: number, from?: string, by?: string | null): OfflineOp => ({
  key: `order_status:${orderId}`, kind: "order_status", id: orderId, value: status, at, from, ...(by ? { by } : {}),
});

// Money taken at the window with no signal (0341). The till does not wait for bars, so the tap is
// kept and replayed like a status change. Its own key, so it never coalesces with the ticket's
// status — "paid cash" and "picked up" are two facts, and both have to arrive. Replaying it is safe:
// the database answers "already settled" to a second one and refuses a voided order outright.
export const collectCupOp = (orderId: string, via: string, at: number, by?: string | null): OfflineOp => ({
  key: `collect_cup:${orderId}`, kind: "collect_cup", id: orderId, value: via, at, ...(by ? { by } : {}),
});

/** The next write this person may replay (R10b): their own, or one from before writes were stamped. Another person's
 *  waits for them — cash taken by one crew member is never replayed, and so recorded, as another's. Pure. */
export function nextOwnOp(queue: OfflineOp[], owner: string | null): OfflineOp | undefined {
  return queue.find((q) => !q.by || q.by === owner);
}

// Enqueue with coalescing: a later write to the same target REPLACES the earlier one (the pass
// only cares about the final state of an order — replaying new→making→done as one "done" is
// correct and 3× fewer writes). Order preserved by first-touch so replay stays human-ordered.
// Capped so a pathological session can't grow unbounded (oldest dropped first).
// The coalesced op keeps where the FIRST one started (`from`, 2026-10-11): none of them has been sent, so the database
// is still where the operator's screen was before the first tap — new→making→done replays as new→done.
export function enqueueOp(queue: OfflineOp[], op: OfflineOp, max = 200): OfflineOp[] {
  const i = queue.findIndex((q) => q.key === op.key);
  const next = i >= 0 ? [...queue.slice(0, i), { ...op, from: queue[i].from }, ...queue.slice(i + 1)] : [...queue, op];
  return next.length > max ? next.slice(next.length - max) : next;
}

// A REPLAYED OP LEAVES THE QUEUE BY ITSELF (2026-10-11). The replay kept its own copy of the queue across each write
// and put the copy back, so a tap queued while a write was on its way was erased. It reads the queue again now and
// takes out the op it sent — that op, by key and time, not whatever holds its key now: a tap made meanwhile coalesced
// into its place and is still to be sent. Once the sent op has `landed`, that tap starts from what it set; refused,
// it keeps the view it had.
export function settleOp(queue: OfflineOp[], sent: OfflineOp, landed: boolean): OfflineOp[] {
  return queue.flatMap((q) => (q.key !== sent.key ? [q] : q.at === sent.at ? [] : [landed && q.kind === "order_status" ? { ...q, from: sent.value } : q]));
}

// Drop ops that are too old to be safely replayed (a status set yesterday shouldn't stomp
// today's board — the order it targeted is long resolved by someone else).
export function pruneStale(queue: OfflineOp[], now: number, maxAgeMs = 6 * 60 * 60 * 1000): OfflineOp[] {
  return queue.filter((q) => now - q.at <= maxAgeMs);
}

// Is a cached read snapshot still worth showing? (Fresh enough to orient a human, clearly labeled.)
export function snapshotUsable(savedAt: number, now: number, maxAgeMs = 2 * 60 * 60 * 1000): boolean {
  return savedAt > 0 && now >= savedAt && now - savedAt <= maxAgeMs;
}
