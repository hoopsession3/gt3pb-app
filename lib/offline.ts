// OFFLINE QUEUE — pure list math for the crew console's offline write queue (audit #9: "the KDS
// dies with the signal"). Food trucks work festivals and parking lots with no bars; the moments
// the pass is busiest are exactly the moments connectivity drops. Writes made offline are queued
// here and replayed on reconnect. Pure + deterministic on purpose (unit-tested in smoke); the
// localStorage/flush machinery lives in components/offline.ts.

export type OfflineOp = {
  key: string;      // coalescing identity, e.g. "order_status:<orderId>"
  kind: "order_status";
  id: string;       // target row id
  value: string;    // for order_status: the status to set
  at: number;       // when the human did it (ms) — display + staleness
};

export const orderStatusOp = (orderId: string, status: string, at: number): OfflineOp => ({
  key: `order_status:${orderId}`, kind: "order_status", id: orderId, value: status, at,
});

// Enqueue with coalescing: a later write to the same target REPLACES the earlier one (the pass
// only cares about the final state of an order — replaying new→making→done as one "done" is
// correct and 3× fewer writes). Order preserved by first-touch so replay stays human-ordered.
// Capped so a pathological session can't grow unbounded (oldest dropped first).
export function enqueueOp(queue: OfflineOp[], op: OfflineOp, max = 200): OfflineOp[] {
  const i = queue.findIndex((q) => q.key === op.key);
  const next = i >= 0 ? [...queue.slice(0, i), op, ...queue.slice(i + 1)] : [...queue, op];
  return next.length > max ? next.slice(next.length - max) : next;
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
