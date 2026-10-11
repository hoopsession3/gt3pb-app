import { enqueueOp, pruneStale, orderStatusOp, collectCupOp, type OfflineOp } from "@/lib/offline";

// OFFLINE ENGINE — localStorage persistence for lib/offline's pure queue. One queue for
// the whole crew console; writes that fail on the network are parked here and replayed in order
// when the signal returns ("online" event, visibility, or the safety-net interval). UI listens to
// OFFLINE_EVENT to show the chip / queued count.
// THE REPLAY LIVES APART (2026-10-11): components/offlineReplay. This file rides in every page — the
// customer's order status reads its snapshots — and only the console replays, so what replaying
// needs loads with the console alone.
const KEY = "gt3-offline-queue";
export const OFFLINE_EVENT = "gt3-offline";

export function readQueue(): OfflineOp[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? (arr as OfflineOp[]) : [];
  } catch { return []; }
}

export function writeQueue(q: OfflineOp[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(OFFLINE_EVENT)); } catch { /* ignore */ }
}

// Park an order-status write for replay. Coalesces per order (final state wins). `from`: what the
// ticket showed when it was tapped, sent with the replay as p_from (lib/orderStatus).
export function queueOrderStatus(orderId: string, status: string, from?: string): void {
  writeQueue(enqueueOp(pruneStale(readQueue(), Date.now()), orderStatusOp(orderId, status, Date.now(), from)));
}

// Park money taken at the window for replay (0341). One per order; a second tap replaces the first.
export function queueCollectCup(orderId: string, via: string): void {
  writeQueue(enqueueOp(pruneStale(readQueue(), Date.now()), collectCupOp(orderId, via, Date.now())));
}

// Heuristic: was this a connectivity failure (park + retry) vs. a real server rejection (don't)?
export function isNetworkError(message: string | undefined | null): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /fetch|network|load failed|timed? ?out|connection/i.test(message ?? "");
}

// --- read snapshots: last-known data so a fresh open with no signal still orients the crew ---
export function saveSnapshot<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
}
export function readSnapshot<T>(key: string): { at: number; data: T } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as { at?: number; data?: T };
    if (typeof p.at !== "number" || p.data === undefined) return null;
    return { at: p.at, data: p.data };
  } catch { return null; }
}
