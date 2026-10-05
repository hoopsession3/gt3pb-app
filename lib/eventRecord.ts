// EVENT RECORD — the words for an event's state, in one place.
//
// The database owns the FACTS (0314's v_event_record puts nine tables on one row, and v_event_gaps
// names every way a row contradicts itself or the calendar). This owns how those facts are said:
// what each gap means to a person, which order to show them in, and what an event is waiting on.
//
// Pure so scripts/smoke.cjs can exercise every branch. Same shape as lib/shopOrder.ts and
// lib/operatorDeal.ts. It leans on lib/dates and lib/dayWords for the calendar arithmetic, which are
// pure too, rather than carrying a third copy of "how many days from this key to that one".

import { evDate, sortTime } from "./dates";
import { daysBetween } from "./dayWords";

// ── stage: the lifecycle a person sets (0075 owns the machine; these are just the words) ─────────
export const EVENT_STAGES = ["lead", "confirmed", "prep", "live", "done"] as const;
export type EventStage = (typeof EVENT_STAGES)[number];
export const isEventStage = (v: unknown): v is EventStage =>
  typeof v === "string" && (EVENT_STAGES as readonly string[]).includes(v);

const STAGE_LABEL: Record<EventStage, string> = {
  lead: "Lead", confirmed: "Confirmed", prep: "In prep", live: "Live", done: "Done",
};
export const stageLabel = (s: string | null | undefined): string =>
  isEventStage(s) ? STAGE_LABEL[s] : (s || "—");

/** Stages where the event has not happened yet and can still be worked on. */
export const isPlanning = (s: string | null | undefined): boolean =>
  s === "lead" || s === "confirmed" || s === "prep";

// ── phase: where the calendar says it sits. Not the same question as stage — the two disagreeing
//    IS the finding (see the stale_stage gap), so they stay separate all the way to the screen.
export type EventPhase = "undated" | "upcoming" | "today" | "past";

/**
 * "in 14 days", "today", "38 days ago", "no date yet". Written out rather than a bare number
 * because "38" next to a date is ambiguous about which side of today it falls on, and that is
 * exactly the confusion that let two events sit at 'confirmed' for a month after they happened.
 */
export function whenLabel(phase: string | null | undefined, daysAway: number | null | undefined): string {
  if (phase === "undated" || daysAway == null) return "no date yet";
  const d = Number(daysAway);
  if (!Number.isFinite(d)) return "no date yet";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${Math.abs(d)} days ago`;
}

// ── THE PHASE, FOR A READER HOLDING THE ROW AND NOT THE VIEW (2026-10-05) ────────────────────────
// Plan › Events reads `events` itself, because its editor writes columns v_event_record leaves out.
// So it has a day and no phase, and it had been listing every event in the order they were created:
// Ryan's phone showed Oct 24, then Aug 15, then Aug 23, then Jul 31, each headed "EVENT 01"… — the
// two still marked confirmed weeks after their date read exactly like the one three weeks ahead.
//
// This is v_event_record's rule, written once for that reader. `today` is the BUSINESS day
// (etToday) — the day 0348 puts the view on — so this list and Needs sorting above it cannot file
// one event on two sides of midnight. Keys are YYYY-MM-DD, so string order is date order.
export function eventPhase(day: string | null | undefined, today: string): EventPhase {
  const d = String(day ?? "").slice(0, 10);
  if (!d) return "undated";
  return d > today ? "upcoming" : d === today ? "today" : "past";
}

/**
 * "Sat, Oct 24 · in 19 days" — the line a dated row leads with: the date, then which side of today
 * it falls on, in whenLabel's words. Takes a day KEY, so a stop's timestamp is keyed by the caller
 * on the business day first and reads the same way as an event beside it.
 */
export function dateLine(day: string | null | undefined, today: string): string {
  const key = String(day ?? "").slice(0, 10);
  const date = key ? evDate({ day: key }) : null;
  if (!date) return "No date yet";
  return `${date} · ${whenLabel(eventPhase(key, today), daysBetween(today, key))}`;
}

export type ListedEvent = { day?: string | null; stage?: string | null; is_live?: boolean | null; start_time?: string | null };
export type EventPiles<T> = { next: T[]; unwrapped: T[]; done: T[] };

const dayOf = (r: ListedEvent) => String(r.day ?? "").slice(0, 10);
// Plain code-unit order: the keys are fixed-width digits, and localeCompare would put a symbol
// before a digit in some locales.
const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** Most recent day first, undated last — how anything already behind us is listed. */
export const newestFirst = (a: ListedEvent, b: ListedEvent): number =>
  Number(!dayOf(a)) - Number(!dayOf(b)) || cmp(dayOf(b), dayOf(a));

/**
 * The three piles an events list is read in.
 *   next       live first, then by day and start time; undated last, where "no date yet" waits
 *   unwrapped  the day has passed and the stage still says it is being planned — v_event_gaps'
 *              stale_stage, which Needs sorting also names. Most recent first.
 *   done       wrapped. Most recent first.
 * The stage is NOT rewritten to suit the pile: a confirmed event in the past still says Confirmed,
 * under a heading that says it is past. The disagreement is the finding (see `phase` above).
 */
export function eventPiles<T extends ListedEvent>(rows: readonly T[], today: string): EventPiles<T> {
  const piles: EventPiles<T> = { next: [], unwrapped: [], done: [] };
  for (const r of rows) {
    if (r.is_live) piles.next.push(r);
    else if (r.stage === "done") piles.done.push(r);
    else if (eventPhase(r.day, today) === "past") piles.unwrapped.push(r);
    else piles.next.push(r);
  }
  // Undated after dated in every pile. Inside a day, clock order with the untimed after the timed —
  // lib/dates' byClock rule: "sometime Saturday" belongs below "Saturday at 2", not at midnight.
  const clock = (a: T, b: T) => {
    const x = sortTime(a.start_time), y = sortTime(b.start_time);
    return x && y ? cmp(x, y) : x ? -1 : y ? 1 : 0;
  };
  const ahead = (a: T, b: T) => Number(!!b.is_live) - Number(!!a.is_live)
    || Number(!dayOf(a)) - Number(!dayOf(b))
    || cmp(dayOf(a), dayOf(b))
    || clock(a, b);
  piles.next.sort(ahead);
  piles.unwrapped.sort(newestFirst);
  piles.done.sort(newestFirst);
  return piles;
}

/**
 * The venue, unless the title already says it. "Sassafras Flower Farm" under "Sassafras Flower Farm",
 * or "Soul Yoga" under "Soul Yoga Workshop — serve window", is one fact twice and pushes the time
 * off a phone-width row. Whole words, either case, punctuation aside: "Main" is not inside "Maine".
 */
export function placeBesideTitle(title: string | null | undefined, place: string | null | undefined): string {
  const p = String(place ?? "").trim();
  const words = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!words(p)) return "";
  return ` ${words(title)} `.includes(` ${words(p)} `) ? "" : p;
}

// ── gaps: the vocabulary of v_event_gaps ─────────────────────────────────────────────────────────
export const GAP_KEYS = [
  "no_title", "no_day", "done_early", "twin", "live_past", "stale_stage", "no_sales",
  "no_recap", "open_tasks",
] as const;
export type GapKey = (typeof GAP_KEYS)[number];
export type GapSeverity = "high" | "medium" | "low";

/** What to DO about it — the view supplies the diagnosis, this supplies the next move. */
const GAP_FIX: Record<GapKey, string> = {
  no_title: "Give it a name.",
  no_day: "Put a date on it, or archive it.",
  done_early: "Either move the date back, or take it out of Done.",
  twin: "Keep the one carrying the RSVPs and the menu; archive the other.",
  live_past: "Turn the live flag off — the public site reads it.",
  stale_stage: "Wrap it if it happened, archive it if it didn't.",
  no_sales: "Add what it took, or confirm it took nothing.",
  no_recap: "Two lines on how it went, while you still remember.",
  open_tasks: "Tick them or delete them — they are counted as outstanding everywhere.",
};
export const gapFix = (k: string | null | undefined): string =>
  (k && (GAP_FIX as Record<string, string>)[k]) || "";

// ── the way OUT of each gap (2026-10-03) ─────────────────────────────────────────────────────────
// gapFix says what to do. This says what the record sheet puts a BUTTON on, so a finding is never a
// sentence pointing at a door that is not there — which is what "Two lines on how it went" was on
// the WineXpress sheet until this. The vocabulary is closed and scripts/smoke.cjs checks that every
// gap has at least one, and that components/EventRecord.tsx renders every one of them.
//
//   edit      the editor behind the prep checklist (OwnerDetails) — title, date, place
//   archive   it did not happen, or this is the duplicate: off the lists, record kept
//   wrap      it happened: done, stamped, with the note       (lib/wrap.wrapOwner)
//   recap     the note alone, for something already done     (lib/wrap.saveRecap)
//   takings   what it took — the number, or "nothing"        (lib/wrap.addTakings / tookNothing)
//   live_off  clear the live flag the public site reads      (lib/wrap.setEventLive)
//   prep      the checklist itself
export const WAYS_OUT = ["edit", "archive", "wrap", "recap", "takings", "live_off", "prep"] as const;
export type WayOut = (typeof WAYS_OUT)[number];

const GAP_WAY: Record<GapKey, readonly WayOut[]> = {
  no_title:    ["edit"],
  no_day:      ["edit", "archive"],
  done_early:  ["edit"],
  twin:        ["edit", "archive"],
  live_past:   ["live_off"],
  stale_stage: ["wrap", "archive"],
  no_sales:    ["takings"],
  no_recap:    ["recap"],
  open_tasks:  ["prep"],
};
export const gapWaysOut = (k: string | null | undefined): readonly WayOut[] =>
  (k && (GAP_WAY as Record<string, readonly WayOut[]>)[k]) || [];

const SEVERITY_RANK: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 };
export const severityRank = (s: string | null | undefined): number =>
  (s && (SEVERITY_RANK as Record<string, number>)[s] != null) ? SEVERITY_RANK[s as GapSeverity] : 3;

/** Worst first, then stable by key, so the list does not reshuffle between renders. */
export function sortGaps<T extends { severity?: string | null; gap?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) ||
    String(a.gap ?? "").localeCompare(String(b.gap ?? "")));
}

// ── what an event is waiting on ──────────────────────────────────────────────────────────────────
export type EventCounts = {
  stage?: string | null; phase?: string | null;
  tasks?: number | null; tasks_open?: number | null; tasks_critical_open?: number | null;
  staff?: number | null; sales_count?: number | null; recap?: string | null;
  took_nothing_at?: string | null;
};

/**
 * One sentence for the top of the record. Says the single most useful thing, not a summary of
 * everything — a header that lists six numbers is a header nobody reads.
 */
export function owedLine(e: EventCounts | null | undefined): string {
  if (!e) return "";
  const crit = Number(e.tasks_critical_open ?? 0);
  const open = Number(e.tasks_open ?? 0);
  const staff = Number(e.staff ?? 0);

  if (e.stage === "done") {
    // "Took nothing", said once (0339), is an answer — not the absence of one.
    if (Number(e.sales_count ?? 0) === 0 && !e.took_nothing_at) return "Finished, with nothing recorded as taken.";
    if (!String(e.recap ?? "").trim()) return "Finished. No after-action note yet.";
    return "Finished and written up.";
  }
  if (e.phase === "past") return "The day has passed and this is still being planned.";
  if (crit > 0) return crit === 1 ? "1 critical job still open." : `${crit} critical jobs still open.`;
  if (staff === 0) return "Nobody is on it yet.";
  if (open > 0) return open === 1 ? "1 job left." : `${open} jobs left.`;
  return "Nothing outstanding.";
}

/** money, in the house's short form: $42 rather than $42.00, $19.99 when the cents matter. */
// The canonical formatter lives in lib/money. Re-exported, not copied — these two files
// carried byte-identical copies of it, which is how the app ended up with thirty.
export { money } from "./money";

/** "Unity Park · Greenville, SC" — drops the gaps rather than printing "null". */
export function placeLine(p: { location_text?: string | null; county?: string | null; state?: string | null } | null | undefined): string {
  if (!p) return "";
  const tail = [p.county, p.state].map((v) => (v ?? "").toString().trim()).filter(Boolean).join(", ");
  return [(p.location_text ?? "").toString().trim(), tail].filter(Boolean).join(" · ");
}

/**
 * The prep checklist still lives at ?s=prep behind a localStorage handoff (PrepDetail, 581 lines
 * inside app/crew/page.tsx). This builds the key it expects. Five call sites wrote this by hand in
 * TWO encodings — four bare ids, one "event:<id>" — and the reader carried a conditional to cope.
 * One function now, so the next caller cannot invent a third.
 */
export const prepHandoffKey = "gt3-prep-open";
export const prepHandoffValue = (kind: "event" | "stop", id: string): string =>
  kind === "stop" ? `stop:${id}` : id;
