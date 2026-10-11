import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingFunction } from "./schemaSkew";

// THE PASS MOVES AN ORDER FROM WHAT IT SHOWED (2026-10-11).
//
// One home for a status write on the pass: a tap on the Kitchen board (app/crew/page.tsx) and the same tap replayed
// from the offline queue (components/offlineReplay). Both go through staff_set_order_status, and both say what the
// operator's screen showed when they tapped (p_from). Two phones on one pass — or one that tapped with no signal and
// sent it later — used to land a tap whatever had happened since: an order picked up at the window put back to Ready
// by the other phone's late tap, a void undone by a replay. The database refuses that now. A move from a status the
// order has already left raises 'order_moved', with the status it is in now as `details`; void is final; the same
// status again is nothing to do.
//
// UNTIL THE DATABASE HAS IT. The migration may not be pasted yet, and PostgREST answers PGRST202 — no function takes
// those arguments (lib/schemaSkew isMissingFunction). Then the move is made as it always was, without p_from (the same
// move, unchecked), and that is remembered for the session: every later tap is one request, not two.
//
// Pure apart from the write, which takes the client (lib/collect's shape), so scripts/smoke.cjs runs it on a fake.

/** A status in the pass's own words: its stages, and "Picked up" for done. */
export const STATUS_WORD: Record<string, string> = { new: "New", preparing: "In progress", ready: "Ready", done: "Picked up", void: "Void" };

/** An order by its ticket's number, as the pass prints it: "#AB12". */
export const ticketNo = (id: string): string => `#${id.slice(0, 4).toUpperCase()}`;

export type StatusError = { message: string; code?: string | null; details?: string | null };

// This database has no p_from yet: found on the first tap that asked, kept until the page is reloaded.
let noFrom = false;

/** Move an order to `status`. `from`: the status the screen showed when the operator tapped (none: not known). */
export async function setOrderStatus(sb: SupabaseClient, id: string, status: string, from?: string | null): Promise<{ error: StatusError | null }> {
  if (from && !noFrom) {
    const res = await sb.rpc("staff_set_order_status", { p_order: id, p_status: status, p_from: from });
    if (!isMissingFunction(res.error)) return res;
    noFrom = true;
  }
  return await sb.rpc("staff_set_order_status", { p_order: id, p_status: status });
}

/** Where the order is now, when the database refused the move because it had moved on ("" if it did not say); null
 *  for every other answer. Expected on a busy pass — a toast and a fresh board, never an error. */
export const movedTo = (e: StatusError | null | undefined): string | null => (e?.message === "order_moved" ? e.details ?? "" : null);

/** "#AB12 is Picked up now" — a tap that found its order already moved on. */
export const movedLine = (id: string, now: string): string => `${ticketNo(id)} ${now ? `is ${STATUS_WORD[now] ?? now} now` : "has moved on"}`;

/** An offline change the database refused when it was replayed. `now`: movedTo's answer for a status change. */
export type Refused = { kind: string; id: string; value: string; reason: string; now: string | null };

/** The toast for what one replay could not save: "Couldn't save offline change: #AB12 → Ready (order is void now)". */
export function refusedToast(list: readonly Refused[]): string {
  const what = (r: Refused) => (r.kind === "collect_cup" ? `${r.value === "cash" ? "cash" : "card-reader"} payment` : `→ ${STATUS_WORD[r.value] ?? r.value}`);
  const why = (r: Refused) => (r.now === null ? r.reason : r.now ? `order is ${(STATUS_WORD[r.now] ?? r.now).toLowerCase()} now` : "the order had moved on");
  return `Couldn't save ${list.length === 1 ? "offline change" : `${list.length} offline changes`}: ${list.map((r) => `${ticketNo(r.id)} ${what(r)} (${why(r)})`).join("; ")}`;
}
