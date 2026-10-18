// MONEY THAT ARRIVES — the one home, in the app, for "does this customer still owe us?" on a cup
// order or a pickup pack, for the two ways the crew records that they do not, and for an office
// invoice being paid (2026-10-04, migration 0341).
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
// orders.paid and drop_orders.paid were written true by exactly two things — the online checkout and
// the online reserve. Nothing else, anywhere. So an order placed "pay at the truck" said UNPAID on
// the pass for ever, the pickup board went on counting money already in the till as "still to
// collect at the window", the customer's own app said "$ at pickup" on a pack they had paid for, and
// the CRM carried every one of them as an open balance. There was no button because there was no
// write for one to make.
//
// ── CASH IS NOT THE READER ─────────────────────────────────────────────────────────────────────
// Ryan: "Both cash and reader." They are different writes, because they are counted in different
// places:
//   · cash is in the till and nowhere else, so it sets `paid` and report_sales counts it like a card
//     paid online;
//   · the card reader is Square. Every completed Square payment is mirrored into event_sales and
//     counted as a walk-up unless it is linked to an order — and nothing links a reader payment to a
//     pre-order (fresh payment, tips, two $9 orders at one window). So it is ALREADY counted. It
//     records that the customer owes nothing and leaves `paid` alone; counting it here as well
//     would be the same money twice.
// That is why the crew is told, at the tap, which one does what (VIA_HINT below).
//
// ── ONE RULE, TWO PLACES THAT MUST AGREE ───────────────────────────────────────────────────────
// Settled = paid, or collected at the window. In the database that is the 0155 sync triggers, which
// derive payment_status from it (0341); here it is isSettled(), in lib/settled.ts — a file of its own
// because the customer's screens need only that and ride in every page's bundle.
// scripts/db.collect.test.mjs compiles both files and runs the rule against the trigger, so they
// cannot drift. isSettled() also reads payment_status, so a screen that selected only columns older
// than 0341 still gets the true answer.
//
// The rules are pure so scripts/smoke.cjs can hold them; the writers take the client (lib/upkeep's
// shape), so a component and a fake run the same code.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSettled, type Collectable } from "./settled";

// The rule itself lives in lib/settled.ts — the customer's screens need only it, and every page
// loads what they import. Re-exported so the crew's code has one place to import from.
export { isSettled, type Collectable };

/** The ways an order is settled at the window: the two that take money, and covered — a free cup or the member's credit
 *  (0416), which takes none and is counted nowhere as money. */
// vocab: orders.collected_via
export const COLLECT_VIA = ["cash", "card_reader", "covered"] as const;
export type CollectVia = (typeof COLLECT_VIA)[number];

/** What the crew reads on the button, and what the tap means for the count. */
export const VIA_LABEL: Record<CollectVia, string> = { cash: "Cash", card_reader: "Card reader", covered: "Free cup or credit" };
export const VIA_HINT: Record<CollectVia, string> = {
  cash: "In the till. Don't ring it on Square too — it counts here.",
  card_reader: "Rung on the Square reader — it counts there.",
  covered: "Their free cup or credit — take it off on the scan screen first, and this finds it. No money changes hands, and none is counted.",
};
/** ON THE HOUSE (0432 — R27 of the 10/10 audit, database F17; Ryan: "Owner/admin, with a reason"). Covered with nothing
 *  taken off for the member — no free cup redeemed, no credit used today — is an owner's or admin's to give, and their
 *  reason is the record (covered_settles). The answer CollectSheet gives for it: the reason, said as typed. */
export type OnTheHouse = { house: string };
export const HOUSE_LABEL = "On the house";
export const HOUSE_HINT = "Nothing taken off for them? Say why — the reason is kept with it. No money changes hands.";
/** A reason the database takes: three characters or more, kept to 200 (0432). */
export const houseReasonOk = (why: string): boolean => why.trim().length >= 3;
/** What a settle sends: the way, and the reason when it is on the house. */
export function settleOf(how: CollectVia | OnTheHouse): { via: CollectVia; reason?: string } {
  return typeof how === "object" ? { via: "covered", reason: how.house.trim().slice(0, 200) } : { via: how };
}
/** The chip a settled ticket wears, and what its undo takes back. */
export const VIA_CHIP: Record<CollectVia, string> = { cash: "Cash", card_reader: "Reader", covered: "Covered" };
export const VIA_UNDO: Record<CollectVia, string> = { cash: "the cash payment", card_reader: "the card-reader payment", covered: "the covered settle" };
/** A settled row's way, or null — a value older code wrote that is not one of the three reads as none. */
export const viaOf = (r: { collected_via?: string | null }): CollectVia | null =>
  (COLLECT_VIA as readonly string[]).includes(r.collected_via ?? "") ? (r.collected_via as CollectVia) : null;

/** Which board the row is on: the channel words cancel_any_order and all_orders already use. */
export type CollectKind = "cup" | "pickup";

/**
 * Can the crew take money for this row here? Only when something is owed AND the database can
 * record it — a `select("*")` row carries `collected_at` once 0341 is applied, and before that the
 * key is simply absent. The row says what the database can do; no second flag to keep in step.
 */
export function canCollect(r: Collectable & { total_cents?: number | null }): boolean {
  // Nothing owed on $0 (R7b): a pack on us — a founding member's refill — is reserved as nothing charged, and the window
  // asked the crew to collect $0.00 from it, at the button and again at the hand-off.
  return "collected_at" in r && !isSettled(r) && r.total_cents !== 0;
}

/** How it was paid: at the window by one of the ways (covered included), online by card, paid some other way, or not. */
export function paidHow(r: Collectable): CollectVia | "online" | "paid" | null {
  const via = viaOf(r);
  if (via) return via;
  if (!isSettled(r)) return null;
  return r.payment_id ? "online" : "paid";
}

/** The pass's money word (uppercase, like the rest of a ticket). `done` = already handed over. */
export function passWord(r: Collectable, done = false): string {
  const how = paidHow(r);
  if (how === "cash") return "PAID · cash";
  if (how === "card_reader") return "PAID · reader";
  if (how === "covered") return "COVERED · free cup or credit";
  if (how) return "PAID";
  return done ? "UNPAID" : "UNPAID · collect at pickup";
}

/** The accountant's word, for an export. */
export function ledgerWord(r: Collectable): string {
  const how = paidHow(r);
  if (how === "cash") return "cash at the window";
  if (how === "card_reader") return "card reader at the window";
  if (how === "covered") return "covered at the window (free cup or credit)";
  if (how === "online") return "paid online";
  if (how === "paid") return "paid";
  return "unpaid";
}

/**
 * What a row looks like once collected — the optimistic patch, by the database's own rule: cash
 * sets paid, the reader does not, payment_status follows settled.
 */
export function collectedPatch(r: Collectable, via: CollectVia, at: string, by: string | null) {
  return {
    paid: r.paid === true || via === "cash",
    collected_via: via, collected_at: at, collected_by: by,
    payment_status: "paid",
  };
}

/** …and once a collection is taken back: only cash ever set paid, so only cash unsets it. */
export function undonePatch(r: Collectable) {
  const paid = r.collected_via === "cash" ? false : r.paid === true;
  return {
    paid,
    collected_via: null, collected_at: null, collected_by: null,
    payment_status: paid ? "paid" : "pending",
  };
}

/** The undo window — the database's own (staff_undo_collection): the collector's, for an hour. */
export const UNDO_WINDOW_MS = 60 * 60 * 1000;

/** May this viewer take back this collection? Their own within the hour, or an admin any time. */
export function canUndo(r: Collectable, me: string | null, admin: boolean, now = Date.now()): boolean {
  if (!r.collected_at || !viaOf(r)) return false;
  if (admin) return true;
  const at = Date.parse(r.collected_at);
  return !!me && r.collected_by === me && Number.isFinite(at) && now - at < UNDO_WINDOW_MS;
}

// ── THE WRITES ─────────────────────────────────────────────────────────────────────────────────
// Each is one RPC (0341): staff-only, tenant-scoped, the row locked. They answer in words a person
// can read, so an error is shown as it comes.

export type CollectResult = { error: string | null; already: boolean };

/** Take the money. `already` = it was settled before this tap (a second tap, or paid online since). `reason`: on the
 *  house (0432) — sent only then, so every other settle is the three arguments it always was. */
export async function collectPayment(sb: SupabaseClient, kind: CollectKind, id: string, via: CollectVia, reason?: string): Promise<CollectResult> {
  const { data, error } = await sb.rpc("staff_collect_payment", { p_kind: kind, p_id: id, p_via: via, ...(reason ? { p_reason: reason } : {}) });
  if (error) return { error: error.message, already: false };
  return { error: null, already: data === "already settled" };
}

/** Take it back. `already` = there was nothing to take back. */
export async function undoCollection(sb: SupabaseClient, kind: CollectKind, id: string): Promise<CollectResult> {
  const { data, error } = await sb.rpc("staff_undo_collection", { p_kind: kind, p_id: id });
  if (error) return { error: error.message, already: false };
  return { error: null, already: data === "nothing to undo" };
}

/** An office invoice paid by cheque or transfer: settles the invoice and its order in one write. */
export async function markInvoicePaid(sb: SupabaseClient, id: string): Promise<CollectResult> {
  const { data, error } = await sb.rpc("mark_invoice_paid", { p_invoice: id });
  if (error) return { error: error.message, already: false };
  return { error: null, already: data === "already paid" };
}
