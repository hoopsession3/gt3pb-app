// EVENT RECORD — the words for an event's state, in one place.
//
// The database owns the FACTS (0314's v_event_record puts nine tables on one row, and v_event_gaps
// names every way a row contradicts itself or the calendar). This owns how those facts are said:
// what each gap means to a person, which order to show them in, and what an event is waiting on.
//
// Pure and dependency-free so scripts/smoke.cjs can exercise every branch. Same shape as
// lib/shopOrder.ts and lib/operatorDeal.ts.

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
    if (Number(e.sales_count ?? 0) === 0) return "Finished, with nothing recorded as taken.";
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
export const money = (cents: number | null | undefined): string => {
  if (cents == null || !Number.isFinite(Number(cents))) return "—";
  const n = Number(cents) / 100;
  return `$${n.toFixed(Math.abs(n * 100) % 100 === 0 ? 0 : 2)}`;
};

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
