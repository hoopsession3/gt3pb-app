// THE CLIENT'S HOME, READ ONE WAY (2026-10-07, Phase 2A-2 of the B2B report — "Your GT3").
//
// office_home (0359) answers an office client's whole home in one call: the company, its programs,
// six weeks of deliveries (skips and pauses included, so they can be undone), the recent ones,
// invoices with their pay link, requests, the jug count, and what the caller may do. This file is the
// one reader of that answer — its types, and every rule the screen draws from it — so the home, the
// change sheet and the calendar cannot disagree about what a delivery is doing, when its changes
// close, or what a tap on Save will ask the database for. Pure: no React, no Supabase, no clock it
// was not handed; scripts/smoke.cjs runs every function here.

import { MARKET_TZ, toMarket } from "./markets";
import { windowHours } from "./office";
import { addDays } from "./dates";

// ── the answer's shape (office_delivery_json and office_home, 0359) ────────────────────────────────
export type OfficeDelivery = {
  id: string;
  date: string;                       // YYYY-MM-DD, the morning it comes
  scheduled_for: string | null;       // the program date it was made for (kept when it moves)
  window: string | null;              // 'mon_0500_0800'
  gallons: number;
  price_per_gallon_cents: number | null;
  total_cents: number;
  status: string;                     // received · brewed · out_for_delivery · delivered · issue
  payment_status: string;             // pending · paid · invoiced · failed · refunded
  driver_outcome: string | null;
  jugs_out: number | null;
  jugs_in: number | null;
  canceled: boolean;
  canceled_reason: string | null;     // skipped · paused · …
  cutoff_at: string | null;           // when changes close (6 PM market time the weekday before)
  open: boolean;                      // changes still open: before the cutoff, nothing under way
  money_locked: boolean;              // paid, invoiced or billed: quantity and skip go through a request
  note_open: boolean;                 // the driver's note, until the driver leaves
  moved_from: string | null;
  client_note: string | null;
  change_reason: string | null;
  changed_at: string | null;
  gallons_changed: boolean;
  location_id: string | null;
  program_id: string | null;
  market: string | null;
  paylink_url: string | null;
};

export type OfficeLocation = { id: string; label: string | null; street: string | null; city: string | null; access: string | null; market: string | null };
export type OfficeAccount = { id: string; standing_active: boolean; standing_gallons: number | null; mine: boolean };
export type OfficeProgram = {
  id: string; location_id: string | null; status: string; every_n_weeks: number; weekdays: number[];
  window: string | null; gallons: number; price_per_gallon_cents: number; account: OfficeAccount | null;
};
export type OfficeInvoice = {
  id: string; amount_cents: number; status: string; terms: string | null; issued_at: string;
  due_at: string | null; paid_at: string | null; order_id: string | null; pay_url: string | null;
};
export type OfficeRequest = {
  id: string; kind: string; label: string; body: string; status: string; order_id: string | null;
  resolution: string | null; created_at: string; resolved_at: string | null;
};
export type OfficeHome = {
  company: { id: string; name: string; status: string; billing_terms: string | null; market: string | null };
  role: string;                       // admin · location_manager · orderer · billing · viewer · crew
  can_change: boolean;
  can_request: boolean;
  today: string;                      // the market's today, YYYY-MM-DD
  min_gallons: number;
  locations: OfficeLocation[];
  programs: OfficeProgram[];
  agenda: OfficeDelivery[];           // today through six weeks, soonest first
  recent: OfficeDelivery[];
  invoices: OfficeInvoice[];
  requests: OfficeRequest[];
  jugs: number;
  /** Read through the tables 0359 had not yet changed (office_home missing): look, don't change. */
  legacy?: boolean;
};

// ── days and times, always in the delivery's own city ──────────────────────────────────────────────
const tzOf = (market: string | null | undefined) => MARKET_TZ[toMarket(market)];
const noonUTC = (key: string) => new Date(`${key}T12:00:00Z`);
const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const DAY_LONG_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
const MONTH_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** "Mon, Oct 12" — a date key as the client reads it (long: "Monday, Oct 12"). */
export function dayLabel(key: string, long = false): string {
  return (long ? DAY_LONG_FMT : DAY_FMT).format(noonUTC(key));
}

/** "Today" / "Tomorrow" / "Mon, Oct 12" against the market's today. */
export function relDay(key: string, today: string, long = false): string {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return dayLabel(key, long);
}

export function monthLabel(year: number, month0: number): string {
  return MONTH_FMT.format(new Date(Date.UTC(year, month0, 15, 12)));
}

/** When a delivery's changes close — "Fri 6 PM", with the date when it is more than six days off —
 *  in the delivery's city, and whether that moment has passed. */
export function cutoffLabel(cutoffISO: string | null, market: string | null, now: number): { closed: boolean; when: string } | null {
  if (!cutoffISO) return null;
  const at = new Date(cutoffISO);
  if (Number.isNaN(at.getTime())) return null;
  const tz = tzOf(market);
  const far = at.getTime() - now > 6 * 86_400_000;
  const day = new Intl.DateTimeFormat("en-US", far ? { timeZone: tz, weekday: "short", month: "short", day: "numeric" } : { timeZone: tz, weekday: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at).replace(":00", "");
  return { closed: at.getTime() <= now, when: far ? `${day} · ${time}` : `${day} ${time}` };
}

// ── what a delivery is doing ───────────────────────────────────────────────────────────────────────
/** The four steps a delivery walks, as the client's card draws them. */
export const STAGES = ["Scheduled", "Brewed", "On the way", "Delivered"] as const;

/** Where it is on those four steps; -1 when it is not walking them (skipped, paused, not delivered). */
export function stageOf(d: Pick<OfficeDelivery, "status" | "canceled">): number {
  if (d.canceled) return -1;
  return d.status === "received" ? 0 : d.status === "brewed" ? 1 : d.status === "out_for_delivery" ? 2 : d.status === "delivered" ? 3 : -1;
}

export type DeliveryState = "scheduled" | "brewed" | "on_the_way" | "delivered" | "missed" | "skipped" | "paused" | "off";

/** One word for one delivery, the same on the card, the calendar and the list. */
export function deliveryState(d: Pick<OfficeDelivery, "status" | "canceled" | "canceled_reason">): { key: DeliveryState; label: string } {
  if (d.canceled) {
    if (d.canceled_reason === "skipped") return { key: "skipped", label: "Skipped" };
    if (d.canceled_reason === "paused") return { key: "paused", label: "Paused" };
    return { key: "off", label: "Canceled" };
  }
  switch (d.status) {
    case "brewed": return { key: "brewed", label: "Brewed" };
    case "out_for_delivery": return { key: "on_the_way", label: "On the way" };
    case "delivered": return { key: "delivered", label: "Delivered" };
    case "issue": return { key: "missed", label: "Not delivered" };
    default: return { key: "scheduled", label: "Scheduled" };
  }
}

/** The delivery the top card is about: the first one still coming (today's stays until tomorrow,
 *  delivered or not, so the client sees it arrive). Skips and pauses are not "next". */
export function nextDelivery(agenda: OfficeDelivery[]): OfficeDelivery | null {
  return agenda.find((d) => !d.canceled) ?? null;
}

/** Can this delivery still change, now? The database's word (`open`), and the clock since it said it:
 *  a page left open past 6 PM must not offer a Save the database will refuse. */
export function changeable(d: Pick<OfficeDelivery, "open" | "cutoff_at">, now: number): boolean {
  if (!d.open) return false;
  const cut = d.cutoff_at ? Date.parse(d.cutoff_at) : NaN;
  return Number.isNaN(cut) || cut > now;
}

// ── the program, said once ─────────────────────────────────────────────────────────────────────────
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Every Monday · 5–8 AM", "Every other Tuesday · 6–9 AM", "Mon & Thu · 5–8 AM". */
export function programLine(p: Pick<OfficeProgram, "every_n_weeks" | "weekdays" | "window">): string {
  const days = [...(p.weekdays ?? [1])].sort((a, b) => a - b);
  const which = days.length === 1 ? WEEKDAY[days[0]] ?? "Monday" : days.map((d) => WEEKDAY_SHORT[d] ?? "").filter(Boolean).join(" & ");
  const every = p.every_n_weeks === 2 ? "Every other " : p.every_n_weeks > 2 ? `Every ${p.every_n_weeks} weeks on ` : days.length === 1 ? "Every " : "";
  return `${every}${which} · ${windowHours(p.window)}`;
}

// ── the calendar ───────────────────────────────────────────────────────────────────────────────────
export type CalDay = { key: string; day: number; inMonth: boolean };

/** One month as Monday-first weeks, padded with the days either side so every week has seven. */
export function monthGrid(year: number, month0: number): CalDay[][] {
  const first = new Date(Date.UTC(year, month0, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;                 // Monday = 0
  const start = new Date(first); start.setUTCDate(1 - lead);
  const weeks: CalDay[][] = [];
  const cur = new Date(start);
  do {
    const week: CalDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ key: cur.toISOString().slice(0, 10), day: cur.getUTCDate(), inMonth: cur.getUTCMonth() === month0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cur.getUTCMonth() === month0);
  return weeks;
}

/** The months the calendar can show: this month through the last one with a delivery in it. */
export function calendarMonths(agenda: Pick<OfficeDelivery, "date">[], today: string): { year: number; month0: number }[] {
  const [y, m] = today.split("-").map(Number);
  const last = agenda.reduce((mx, d) => (d.date > mx ? d.date : mx), today);
  const [ly, lm] = last.split("-").map(Number);
  const out: { year: number; month0: number }[] = [];
  let yy = y, mm = m - 1;
  while (yy < ly || (yy === ly && mm <= lm - 1)) {
    out.push({ year: yy, month0: mm });
    if (mm === 11) { yy += 1; mm = 0; } else mm += 1;
  }
  return out.length ? out : [{ year: y, month0: m - 1 }];
}

/** The agenda keyed by morning — a day can hold more than one (two locations). */
export function byDate<T extends Pick<OfficeDelivery, "date">>(agenda: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const d of agenda) (out[d.date] ??= []).push(d);
  return out;
}

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

// ── requests and invoices, in the client's words ───────────────────────────────────────────────────
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

export function requestState(status: string): { key: "sent" | "working" | "done" | "declined"; label: string } {
  switch (status) {
    case "in_progress": return { key: "working", label: "On it" };
    case "done": return { key: "done", label: "Done" };
    case "declined": return { key: "declined", label: "Declined" };
    default: return { key: "sent", label: "Sent" };
  }
}

/** An invoice's one line: paid, canceled, overdue, due on a day, or open. */
export function invoiceState(v: Pick<OfficeInvoice, "status" | "due_at">, today: string): { key: "paid" | "void" | "overdue" | "due" | "open"; label: string } {
  if (v.status === "paid") return { key: "paid", label: "Paid" };
  if (v.status === "void") return { key: "void", label: "Canceled" };
  if (v.due_at) {
    const due = v.due_at.slice(0, 10);
    const short = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(noonUTC(due));
    return due < today ? { key: "overdue", label: `Overdue · was due ${short}` } : { key: "due", label: `Due ${short}` };
  }
  return { key: "open", label: "Open" };
}

// ── before 0359: the same home, read from the tables as they were ─────────────────────────────────
export type LegacyAccount = { id: string; company: string; standing_active: boolean; standing_gallons: number | null; jug_balance: number; billing_terms: string; market?: string | null };
export type LegacyOrder = { id: string; delivery_date: string; delivery_window: string | null; gallons: number; total_cents: number; status: string; payment_status: string };
export type LegacyInvoice = { id: string; amount_cents: number; status: string; issued_at: string; terms: string; due_at: string | null };

const legacyDelivery = (o: LegacyOrder, market: string | null): OfficeDelivery => ({
  id: o.id, date: o.delivery_date, scheduled_for: o.delivery_date, window: o.delivery_window, gallons: Number(o.gallons),
  price_per_gallon_cents: null, total_cents: o.total_cents, status: o.status, payment_status: o.payment_status, driver_outcome: null,
  jugs_out: null, jugs_in: null, canceled: false, canceled_reason: null, cutoff_at: null, open: false, money_locked: o.payment_status !== "pending",
  note_open: false, moved_from: null, client_note: null, change_reason: null, changed_at: null, gallons_changed: false,
  location_id: null, program_id: null, market, paylink_url: null,
});

/** The account page as it read before 0359, in the new shape: its weekly order (the holder's to
 *  pause), the deliveries coming and gone, the invoices — and no per-delivery changes, which need
 *  0359's function. */
export function legacyHome(a: LegacyAccount, upcoming: LegacyOrder[], recent: LegacyOrder[], invoices: LegacyInvoice[], today: string, priceCents: number, minGallons: number): OfficeHome {
  const market = a.market ?? null;
  return {
    company: { id: a.id, name: a.company, status: "live", billing_terms: a.billing_terms, market },
    role: "admin", can_change: false, can_request: false, today, min_gallons: minGallons,
    locations: [],
    programs: [{ id: a.id, location_id: null, status: a.standing_active ? "active" : "paused", every_n_weeks: 1, weekdays: [1], window: null,
      gallons: a.standing_gallons ?? minGallons, price_per_gallon_cents: priceCents,
      account: { id: a.id, standing_active: a.standing_active, standing_gallons: a.standing_gallons, mine: true } }],
    agenda: upcoming.map((o) => legacyDelivery(o, market)),
    recent: recent.map((o) => legacyDelivery(o, market)),
    invoices: invoices.map((v) => ({ id: v.id, amount_cents: v.amount_cents, status: v.status, terms: v.terms, issued_at: v.issued_at, due_at: v.due_at, paid_at: null, order_id: null, pay_url: null })),
    requests: [], jugs: a.jug_balance, legacy: true,
  };
}

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
