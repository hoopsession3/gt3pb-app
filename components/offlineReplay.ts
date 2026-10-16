import type { SupabaseClient } from "@supabase/supabase-js";
import { nextOwnOp, pruneStale, settleOp } from "@/lib/offline";
import { setOrderStatus, movedTo, type Refused } from "@/lib/orderStatus";
import { readQueue, writeQueue, isNetworkError, queueOwner } from "./offline";
import { reportClientError } from "./ErrorReporter";
import { notifyVoid } from "@/lib/voidNotice";

// THE REPLAY — the offline queue (components/offline) sent when the signal returns. Its own file since 2026-10-11:
// the queue rides in every page, the replay only in the console (components/OfflineChip runs it).
//
// Replays in order and stops at the first op that is still offline (it stays, with the rest, for the next pass), so a
// flaky signal can't reorder writes. A status change goes from what the ticket showed when it was tapped (p_from,
// lib/orderStatus), so a replay can no longer land over an order somebody else moved meanwhile.
//
// A TAP MADE DURING A REPLAY IS KEPT. The replay held its own copy of the queue across every write and put that copy
// back, erasing whatever was queued while a write was on its way. Each op is read from storage now, and only the op
// sent leaves it (lib/offline settleOp).
//
// A REFUSAL IS SAID, NOT DROPPED IN SILENCE. A definitive answer from the database — the order was voided, a rule said
// no — still takes the op out (replaying it forever would never succeed), but the operator is told: one event per
// replay, OFFLINE_REFUSED_EVENT, which the console shows as a toast (OfflineChip). A refusal nobody expects is filed
// with the app's errors too (components/ErrorReporter → /api/errors/report, deduped and capped per session).
// 'order_moved' is expected — somebody moved the order while this phone had no signal — so it is told, not filed.
export const OFFLINE_REFUSED_EVENT = "gt3-offline-refused";

let flushing = false;
/** Replay the queue. Returns how many ops remain. */
export async function flushQueue(supabase: SupabaseClient | null): Promise<number> {
  if (!supabase || flushing) return readQueue().length;
  flushing = true;
  const refused: Refused[] = [];
  const sent = new Set<string>();
  try {
    for (;;) {
      // Only this person's own writes (R10b): another's wait for them to sign back in (lib/offline nextOwnOp).
      const op = nextOwnOp(pruneStale(readQueue(), Date.now()), queueOwner());
      // Storage that will not take the write would hand back the op just sent: stop, rather than send it again.
      if (!op || sent.has(`${op.key}@${op.at}`)) break;
      sent.add(`${op.key}@${op.at}`);
      const { error } = op.kind === "collect_cup"
        ? await supabase.rpc("staff_collect_payment", { p_kind: "cup", p_id: op.id, p_via: op.value })
        : await setOrderStatus(supabase, op.id, op.value, op.from);
      if (error && isNetworkError(error.message)) break;       // still offline — try again later
      writeQueue(settleOp(pruneStale(readQueue(), Date.now()), op, !error));   // done (or definitively rejected)
      // A void that waited for signal has landed: the member's email goes now (R9), as it does from the Pass. Its refund
      // flag went with the void itself — the database's (0416).
      if (!error && op.kind === "order_status" && op.value === "void") notifyVoid(op.id);
      if (!error) continue;
      const now = op.kind === "order_status" ? movedTo(error) : null;
      refused.push({ kind: op.kind, id: op.id, value: op.value, reason: error.message, now });
      if (now === null) reportClientError({ message: `Offline change refused (${op.kind} → ${op.value}): ${error.message}` });
    }
    writeQueue(pruneStale(readQueue(), Date.now()));
    if (refused.length > 0) window.dispatchEvent(new CustomEvent<Refused[]>(OFFLINE_REFUSED_EVENT, { detail: refused }));
    return readQueue().length;
  } finally { flushing = false; }
}
