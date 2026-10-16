import type { SupabaseClient } from "@supabase/supabase-js";
import { etToday } from "./dates";
import { etDayStart } from "./etDay";

// ONE NUMBER, ONE ORDER, EACH DAY (R8, 2026-10-16). The window calls an order by the first four characters of its id —
// "#4F2A" (lib/activeOrder orderNo; the ticket, the push and the database's own words say the same four). There are
// 65,536 of them, so at fifty orders a day two orders share a number about one day in fifty, and two people answer the
// call. The checkout makes the id before the row (app/api/checkout), so it draws it again until its four are free among
// the day's orders, Eastern. Not a lock: two checkouts in the same instant could still draw one number — one chance in
// 65,536 — and a read that fails draws as before.

/** The four the window calls, as the crew's search keys them. */
export const dayNoOf = (id: string): string => id.slice(0, 4).toLowerCase();

/** An id whose four are not taken — drawn again while they are, a bounded number of times. */
export function freshId(taken: ReadonlySet<string>, mint: () => string, tries = 32): string {
  let id = mint();
  for (let i = 1; i < tries && taken.has(dayNoOf(id)); i++) id = mint();
  return id;
}

/** The id for a new order: its four free among the orders since midnight Eastern. */
export async function orderIdForToday(db: SupabaseClient, mint: () => string): Promise<string> {
  // scoped-by: ids alone, of the orders since midnight Eastern — the numbers the window may call today, nothing else
  const { data, error } = await db.from("orders").select("id").gte("created_at", etDayStart(etToday()).toISOString()).limit(5000);
  if (error || !data) return mint();
  return freshId(new Set((data as { id: string }[]).map((r) => dayNoOf(String(r.id)))), mint);
}
