// A CHANGE, AND A REQUEST, IN WORDS (2026-10-07, Phase 2A-2 — Your GT3). The part of the client's home
// that only the change sheet, the ask sheet and the crew's route need: what Save asks the database
// for, the words a refused change is sent in, the reasons and the kinds of request, and the crew's
// line for what a client changed. Its own module so it loads with the sheets that use it and not with
// the page every office client opens (lib/officeStatus is that page's reader). Pure; scripts/smoke.cjs
// runs every function here.

import { changeable, dayLabel, type OfficeDelivery } from "./officeStatus";

// ── the change sheet's Save, as steps the database is asked for ───────────────────────────────────
export const OFFICE_REASONS = [
  { key: "fewer_people", label: "Fewer people in" },
  { key: "office_closed", label: "Office closed" },
  { key: "ran_out", label: "We ran out" },
  { key: "other", label: "Something else" },
] as const;
export type OfficeReason = (typeof OFFICE_REASONS)[number]["key"];

export type ChangeDraft = { gallons: number; skip: boolean; moveTo: string | null; note: string; reason: OfficeReason | null };
export type ChangeStep =
  | { change: "quantity"; gallons: number }
  | { change: "skip" }
  | { change: "unskip" }
  | { change: "move"; to: string }
  | { change: "note"; note: string };

/** The sheet opens on the delivery as it is. */
export function draftOf(d: OfficeDelivery): ChangeDraft {
  return { gallons: Math.round(d.gallons), skip: d.canceled && d.canceled_reason === "skipped", moveTo: null, note: d.client_note ?? "", reason: null };
}

const noteOf = (s: string | null | undefined) => (s ?? "").trim() || null;

/**
 * What Save asks for. `steps` go to office_change_delivery in this order (quantity before the move,
 * the note last — each one its own keyed call); `asks` are the parts the database would refuse right
 * now, which the sheet sends as one request instead: everything but the note once changes have closed,
 * the quantity and the skip of a delivery whose money is settled, and the note once the driver has
 * left. A skip is the whole of a change — the quantity, a move and the note of a skipped delivery are
 * not asked for. Nothing changed: no steps, no asks.
 */
export function changePlan(d: OfficeDelivery, draft: ChangeDraft, now: number): { steps: ChangeStep[]; asks: ChangeStep[] } {
  const steps: ChangeStep[] = [], asks: ChangeStep[] = [];
  const open = changeable(d, now);
  const skipped = d.canceled && d.canceled_reason === "skipped";
  const put = (s: ChangeStep, allowed: boolean) => (allowed ? steps : asks).push(s);

  if (skipped) {
    if (!draft.skip) put({ change: "unskip" }, open);
    return { steps, asks };
  }
  if (d.canceled) return { steps, asks };              // paused or off: the program brings it back, not the sheet
  if (draft.skip) {
    put({ change: "skip" }, open && !d.money_locked);
    return { steps, asks };
  }
  const g = Math.round(draft.gallons);
  if (g !== Math.round(d.gallons)) put({ change: "quantity", gallons: g }, open && !d.money_locked);
  if (draft.moveTo && draft.moveTo !== d.date) put({ change: "move", to: draft.moveTo }, open);
  const note = noteOf(draft.note);
  if (note !== noteOf(d.client_note)) put({ change: "note", note: note ?? "" }, d.note_open);
  return { steps, asks };
}

/** A step, in the words a request carries ("Make it 6 gallons"). */
export function stepWords(s: ChangeStep): string {
  switch (s.change) {
    case "quantity": return `Make it ${s.gallons} gallon${s.gallons === 1 ? "" : "s"}`;
    case "skip": return "Skip it";
    case "unskip": return "Bring it back";
    case "move": return `Move it to ${dayLabel(s.to)}`;
    case "note": return s.note ? `Note for the driver: ${s.note}` : "Take the driver's note off";
  }
}

/** The request a refused change becomes: its kind and its words. A change after the cutoff is the
 *  report's own kind; a settled delivery's change before it is a billing question (we settle the
 *  difference). `extra` is anything the client typed. */
export function askOf(d: OfficeDelivery, asks: ChangeStep[], extra: string, now: number): { kind: "change_after_cutoff" | "billing"; body: string } {
  const kind = changeable(d, now) ? "billing" : "change_after_cutoff";
  const lines = asks.map(stepWords).join(". ");
  const body = [`${dayLabel(d.date, true)} delivery: ${lines}.`, extra.trim()].filter(Boolean).join("\n");
  return { kind, body: body.slice(0, 1000) };
}

// ── what a client can ask GT3 for ─────────────────────────────────────────────────────────────────
export const REQUEST_KINDS = [
  { key: "extra_delivery", label: "An extra delivery" },
  { key: "event", label: "An event" },
  { key: "new_location", label: "Another location" },
  { key: "equipment", label: "Equipment" },
  { key: "billing", label: "Billing" },
  { key: "service_issue", label: "Something went wrong" },
  { key: "other", label: "Something else" },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]["key"] | "change_after_cutoff";

// ── what the crew reads about a client's hand on a delivery ───────────────────────────────────────
/** A request's kind in the crew's words — office_request_label (0359), word for word. */
export function requestLabel(kind: string): string {
  switch (kind) {
    case "change_after_cutoff": return "Change after the cutoff";
    case "extra_delivery": return "Extra delivery";
    case "new_location": return "New location";
    case "event": return "Event";
    case "equipment": return "Equipment";
    case "billing": return "Billing question";
    case "service_issue": return "Service issue";
    default: return "Request";
  }
}

/** The client's changes on one delivery, as the crew's route lists them: moved, the gallons they set,
 *  why, and the note for the driver. Nothing changed: nothing said. */
export function clientChanges(o: { moved_from?: string | null; gallons_changed_at?: string | null; gallons?: number; change_reason?: string | null; client_note?: string | null }): string[] {
  const out: string[] = [];
  if (o.moved_from) out.push(`moved from ${dayLabel(o.moved_from)}`);
  if (o.gallons_changed_at) out.push(`set ${Math.round(Number(o.gallons ?? 0))} gal for this day`);
  const why = OFFICE_REASONS.find((r) => r.key === o.change_reason);
  if (why && out.length) out.push(why.label.toLowerCase());
  if (o.client_note) out.push(`“${o.client_note}”`);
  return out;
}
