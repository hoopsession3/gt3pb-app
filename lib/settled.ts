// HAS THIS CUSTOMER PAID? — the rule, on its own (2026-10-04, migration 0341).
//
// Settled = paid (online, or cash at the window) or collected at the window on the card reader,
// which leaves `paid` alone because Square already counts it (lib/collect.ts says why). The
// database's form of the same rule is the 0155 sync triggers as 0341 redefines them, which store the
// answer in payment_status; scripts/db.collect.test.mjs compiles this file and runs both over every
// legal row, so the two cannot drift.
//
// WHY A FILE OF ITS OWN: the customer's screens — the order bar, their packs, their inbox — ask
// only this question, and they ride in the bundle every route loads. lib/collect.ts carries the
// crew's half (the writes, the words, the undo rule); imported from a customer screen it put all of
// that in front of every visitor, about 0.7 KB on every page, measured. The rule lives here;
// lib/collect re-exports it, so the crew imports one place too.

/** The money fields of a cup order or a pack — whichever of them a read selected. */
export type Collectable = {
  paid?: boolean | null;
  payment_id?: string | null;
  payment_status?: string | null;
  collected_via?: string | null;
  collected_at?: string | null;
  collected_by?: string | null;
};

/**
 * Owes nothing: paid, or collected at the window. payment_status is the trigger's stored answer to
 * the same question, read too, so a screen that selected only columns older than 0341 is still told
 * the truth.
 */
export function isSettled(r: Collectable): boolean {
  return r.paid === true || r.collected_at != null || r.payment_status === "paid";
}
