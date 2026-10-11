// THE SUNDAY RUN: ALL OUT AT ONCE, AND A MISSED PORCH ONTO THE NEXT ONE (2026-10-11, the dispatch round).
//
// Two jobs the Sunday card made slow, or left to nobody:
//
//   · Out the door. Each porch took two taps — "→ Brewed", then "→ Out for delivery" — so a run of twenty porches was
//     forty taps at five in the morning before the van moved. "Mark all out for delivery" is the card's own step
//     (status → out_for_delivery, components/DeliveryOps setStatus) for every porch on the run not out yet, behind the
//     confirm sheet: one write per porch and each answer read, so a partial failure names the porches that did not save.
//     A write moves a porch only from received or brewed, so one the driver logged in the meantime is left as it is.
//
//   · Held, not home. A porch the driver could not deliver stayed on its old day, and no screen could put it on a run
//     (the dispatch report's first gap). One tap moves it to the next run: the next delivery day on the board after its
//     own — DeliveryOps' rule for "the run" (nextRunDay), today's run only while today's window is still open — or,
//     with no run on the board yet, the Sunday a new order would get (lib/delivery nextDeliverySlot, the checkout's own
//     rule). It goes back to received: it is brewed fresh for that run, like every porch on it. What the driver wrote on
//     the last attempt stays in the audit trail (0141's audit_delivery_orders keeps every row's before and after), not
//     on the porch. Undo puts back exactly what was there, and only while the porch is as the move left it.
//
// WHY THERE IS NO "ALL DELIVERED". A porch's outcome is the driver's, at the door: the empties counted against what was
// expected, swapped or fresh, not home, held — and the customer's "on your porch" text, which goes only after the save
// (components/DriverRun, THE TEXT FOLLOWS THE SAVE). One tap on the console for twenty porches would record none of that
// truthfully, so it is not offered.
//
// The rules are pure and the writers take the client (lib/collect's shape), so scripts/porchrun.test.mjs runs this
// code against a stand-in table that applies the same filters.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, etDayKey } from "./dates";
import { nextDeliverySlot } from "./delivery";
import { dayAndDate, porchWindow } from "./dueNext";
import { errorMessage } from "./errorMessage";

type Sb = Pick<SupabaseClient, "from">;

// ── WHICH RUN ──────────────────────────────────────────────────────────────────────────────────────
/** The run, as the Sunday card and the driver's screen pick it: the first delivery day on or after today with a porch
 *  on it. Today counts — Sunday IS the run. */
export function nextRunDay(days: readonly string[], today: string): string | null {
  let best: string | null = null;
  for (const d of days) if (d >= today && (best === null || d < best)) best = d;
  return best;
}

export type RunPick = { day: string; from: "run" | "slot" };
/** Where a held or not-home porch goes: the next run on the board after its own day — today's while its window is still
 *  open — else the Sunday a new order would get. `runDays` are the delivery days the card read (today on). */
export function nextRunFor(o: { delivery_date: string; delivery_window?: string | null }, runDays: readonly string[], nowMs: number): RunPick {
  const today = etDayKey(new Date(nowMs));
  const w = porchWindow(today, o.delivery_window ?? null);
  const todayOpen = w ? nowMs < w.end : true;   // a window nobody can read leaves today's run as the card has it
  const day = nextRunDay(runDays.filter((d) => d > o.delivery_date && (d !== today || todayOpen)), today);
  if (day) return { day, from: "run" };
  let slot = nextDeliverySlot(nowMs).deliveryDateKey;
  while (slot <= o.delivery_date) slot = addDays(slot, 7);
  return { day: slot, from: "slot" };
}

/** "today", "tomorrow", else "Sun, Oct 18" — a run's day on a button, where the date is worth the room. */
export function runDayWords(day: string, today: string): string {
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  return dayAndDate(day);
}

// ── ALL OUT AT ONCE ────────────────────────────────────────────────────────────────────────────────
/** What "Mark all out for delivery" moves: the run's porches not out yet. Held, not home, delivered and out already are
 *  left as they are. */
export function outPlan<T extends { status: string; canceled_at?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((o) => !o.canceled_at && (o.status === "received" || o.status === "brewed"));
}

export type PorchStep = { id: string; name: string; status: string };
export type StepResult = { moved: PorchStep[]; skipped: PorchStep[]; failed: (PorchStep & { error: string })[] };

type Answer = { data: unknown[] | null; error: { message: string } | null };
async function oneWrite(p: PorchStep, write: () => PromiseLike<Answer>): Promise<{ p: PorchStep; moved?: boolean; error?: string }> {
  try {
    const { data, error } = await write();
    if (error) return { p, error: error.message };
    return { p, moved: (data ?? []).length > 0 };
  } catch (e) {
    return { p, error: errorMessage(e) };
  }
}
function tally(rs: { p: PorchStep; moved?: boolean; error?: string }[]): StepResult {
  const out: StepResult = { moved: [], skipped: [], failed: [] };
  for (const r of rs) {
    if (r.error !== undefined) out.failed.push({ ...r.p, error: r.error });
    else if (r.moved) out.moved.push(r.p);
    else out.skipped.push(r.p);
  }
  return out;
}

/** Each porch out for delivery — its own write, its own answer. `status` on each is what it was, for the undo. */
export async function markOut(sb: Sb, porches: readonly PorchStep[]): Promise<StepResult> {
  return tally(await Promise.all(porches.map((p) => oneWrite(p, () =>
    sb.from("delivery_orders").update({ status: "out_for_delivery" })
      .eq("id", p.id).in("status", ["received", "brewed"]).is("canceled_at", null).select("id") as unknown as PromiseLike<Answer>))));
}

/** The undo: each porch back to the step it was on — only one still out for delivery (the driver may have logged it). */
export async function unmarkOut(sb: Sb, moved: readonly PorchStep[]): Promise<StepResult> {
  return tally(await Promise.all(moved.map((p) => oneWrite(p, () =>
    sb.from("delivery_orders").update({ status: p.status })
      .eq("id", p.id).eq("status", "out_for_delivery").select("id") as unknown as PromiseLike<Answer>))));
}

const listed = (xs: readonly { name: string }[]) =>
  xs.length <= 3 ? xs.map((x) => x.name).join(", ") : `${xs.slice(0, 3).map((x) => x.name).join(", ")} and ${xs.length - 3} more`;
const porches = (n: number) => `${n} porch${n === 1 ? "" : "es"}`;

/** The toast after "Mark all out": how many went, which did not save (by name), and how many had moved on already. */
export function outWords(r: StepResult): { text: string; error: boolean } {
  const parts = [r.moved.length ? `${porches(r.moved.length)} out for delivery` : "Nothing marked out"];
  if (r.failed.length) parts.push(`didn't save ${listed(r.failed)} — try ${r.failed.length === 1 ? "it" : "them"} again`);
  if (r.skipped.length) parts.push(`${porches(r.skipped.length)} had moved on already`);
  return { text: parts.join(" · "), error: r.failed.length > 0 };
}
/** The toast after its undo. */
export function undoOutWords(r: StepResult): { text: string; error: boolean } {
  const parts = [r.moved.length ? `${porches(r.moved.length)} back as they were` : "Nothing put back"];
  if (r.failed.length) parts.push(`couldn't put back ${listed(r.failed)}`);
  if (r.skipped.length) parts.push(`${porches(r.skipped.length)} logged since — left as logged`);
  return { text: parts.join(" · "), error: r.failed.length > 0 };
}

// ── A MISSED PORCH ONTO THE NEXT RUN ───────────────────────────────────────────────────────────────
/** A porch as it stood before the move — every field the move changes, so the undo can put it back. */
export type MissedPorch = {
  id: string; name: string; delivery_date: string; status: string;
  driver_outcome: string | null; empties_collected: number | null; driver_note: string | null;
};
export type MoveAnswer = { ok: true } | { ok: false; error: string | null };   // error null: it had changed meanwhile

/** Held or not home → the run on `day`, received. Only from held or not home, only from the day it was on. */
export async function moveToRun(sb: Sb, o: MissedPorch, day: string): Promise<MoveAnswer> {
  const r = await oneWrite(o, () =>
    sb.from("delivery_orders").update({ delivery_date: day, status: "received", driver_outcome: null, empties_collected: null, driver_note: null })
      .eq("id", o.id).eq("delivery_date", o.delivery_date).in("status", ["held_for_pickup", "issue"]).is("canceled_at", null)
      .select("id") as unknown as PromiseLike<Answer>);
  return r.error !== undefined ? { ok: false, error: r.error } : r.moved ? { ok: true } : { ok: false, error: null };
}

/** The undo: everything back as it was — only while the porch is still received on the run it was moved to. */
export async function undoMove(sb: Sb, o: MissedPorch, day: string): Promise<MoveAnswer> {
  const r = await oneWrite(o, () =>
    sb.from("delivery_orders").update({ delivery_date: o.delivery_date, status: o.status, driver_outcome: o.driver_outcome, empties_collected: o.empties_collected, driver_note: o.driver_note })
      .eq("id", o.id).eq("delivery_date", day).eq("status", "received")
      .select("id") as unknown as PromiseLike<Answer>);
  return r.error !== undefined ? { ok: false, error: r.error } : r.moved ? { ok: true } : { ok: false, error: null };
}
