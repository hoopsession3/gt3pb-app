import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueOp, pruneStale, orderStatusOp, type OfflineOp } from "@/lib/offline";

// OFFLINE ENGINE — localStorage persistence + replay for lib/offline's pure queue. One queue for
// the whole crew console; writes that fail on the network are parked here and replayed in order
// when the signal returns ("online" event, visibility, or the safety-net interval). UI listens to
// OFFLINE_EVENT to show the chip / queued count.
const KEY = "gt3-offline-queue";
export const OFFLINE_EVENT = "gt3-offline";

export function readQueue(): OfflineOp[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? (arr as OfflineOp[]) : [];
  } catch { return []; }
}

function writeQueue(q: OfflineOp[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(OFFLINE_EVENT)); } catch { /* ignore */ }
}

// Park an order-status write for replay. Coalesces per order (final state wins).
export function queueOrderStatus(orderId: string, status: string): void {
  writeQueue(enqueueOp(pruneStale(readQueue(), Date.now()), orderStatusOp(orderId, status, Date.now())));
}

// Heuristic: was this a connectivity failure (park + retry) vs. a real server rejection (don't)?
export function isNetworkError(message: string | undefined | null): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /fetch|network|load failed|timed? ?out|connection/i.test(message ?? "");
}

// Replay the queue in order. Stops at the first still-failing op (keeps it + the rest for the next
// pass) so a flaky signal can't reorder writes. A definitive server rejection (RLS, bad status)
// drops that op — replaying it forever would never succeed. Returns how many ops remain.
let flushing = false;
export async function flushQueue(supabase: SupabaseClient | null): Promise<number> {
  if (!supabase || flushing) return readQueue().length;
  flushing = true;
  try {
    let queue = pruneStale(readQueue(), Date.now());
    while (queue.length > 0) {
      const op = queue[0];
      const { error } = await supabase.rpc("staff_set_order_status", { p_order: op.id, p_status: op.value });
      if (error && isNetworkError(error.message)) break;       // still offline — try again later
      queue = queue.slice(1);                                   // done (or definitively rejected)
      writeQueue(queue);
    }
    writeQueue(queue);
    return queue.length;
  } finally { flushing = false; }
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
