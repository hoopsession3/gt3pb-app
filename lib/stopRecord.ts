// STOP RECORD — the words for a truck stop's state.
//
// Deliberately thin. whenLabel, sortGaps, severityRank, money and placeLine already exist in
// lib/eventRecord and mean exactly the same thing here, so they are RE-EXPORTED rather than copied.
// A second copy of whenLabel is how "16 Days Ago" would come back on one screen and not the other —
// and copy-drift between near-identical surfaces is the thing this whole audit is about.
//
// What IS stop-specific lives here: the gap vocabulary, the status words, and the one sentence that
// explains the name question to a person who did not read migration 0226.

export {
  whenLabel, sortGaps, severityRank, money, placeLine,
  type GapSeverity,
} from "./eventRecord";

// ── status: a stop's own small vocabulary (0001's check constraint) ──────────────────────────────
export const STOP_STATUSES = ["upcoming", "live", "done"] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];
export const isStopStatus = (v: unknown): v is StopStatus =>
  typeof v === "string" && (STOP_STATUSES as readonly string[]).includes(v);

const STATUS_LABEL: Record<StopStatus, string> = {
  upcoming: "Upcoming", live: "Live now", done: "Done",
};
export const stopStatusLabel = (s: string | null | undefined): string =>
  isStopStatus(s) ? STATUS_LABEL[s] : (s || "—");

// ── gaps: the vocabulary of v_stop_gaps ──────────────────────────────────────────────────────────
export const STOP_GAP_KEYS = [
  "name_drift", "no_pin", "no_day", "live_past", "unlinked", "addr_drift",
  "stale_status", "no_recap",
] as const;
export type StopGapKey = (typeof STOP_GAP_KEYS)[number];

/** The view supplies the diagnosis; this supplies the next move. */
const STOP_GAP_FIX: Record<StopGapKey, string> = {
  name_drift: "Decide which is right. A name like \"— Five Forks\" or \"Saturday\" usually means the venue needs a second location, not the stop needs a rename.",
  no_pin: "Add the address and pin it, or link the venue that already has one.",
  no_day: "Give it a date and time, or archive it.",
  live_past: "Take the truck offline — the public page is still pointing here.",
  unlinked: "Link it to the venue so the next visit reuses the same place.",
  addr_drift: "Decide which address is right, then resync from the venue or fix the venue.",
  stale_status: "Mark it done, or move the date if it hasn't happened yet.",
  no_recap: "Two lines on how it went, while you still remember.",
};
export const stopGapFix = (k: string | null | undefined): string =>
  (k && (STOP_GAP_FIX as Record<string, string>)[k]) || "";

/** Only one gap on this list is visible to a customer. The screen says so. */
export const isGuestFacing = (k: string | null | undefined): boolean =>
  k === "name_drift" || k === "no_pin" || k === "live_past";

/**
 * The sentence that explains the name question without making anyone read migration 0226.
 * Returned only when there IS a disagreement — an explanation nobody needs is noise.
 *
 * Deliberately NOT "the stop is out of date". Measured against production, all three live stops
 * disagreed with their venue and all three had the BETTER name — "Wine Express — Five Forks" and
 * "Wine Express Saturday" against a vendor row reading "WineXpress". Stating a direction here would
 * have pushed three good names towards three worse ones.
 */
export function nameDriftLine(stored: string | null | undefined, canonical: string | null | undefined): string | null {
  const a = (stored ?? "").trim();
  const b = (canonical ?? "").trim();
  if (!a || !b || a === b) return null;
  return `The stop says "${a}". The venue says "${b}".`;
}

/**
 * A stop name that is the venue name PLUS something — "Wine Express — Five Forks", "X Saturday" —
 * is the schema asking for a vendor_location or a recurring slot, not a typo. Worth saying out
 * loud on the one screen where somebody is deciding what to do about it.
 */
export function looksLocationQualified(stored: string | null | undefined, canonical: string | null | undefined): boolean {
  const a = (stored ?? "").trim();
  const b = (canonical ?? "").trim();
  if (!a || !b || a === b) return false;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  // the stop's name contains the venue's, with more on top of it
  return norm(a).length > norm(b).length && norm(a).includes(norm(b));
}

// ── what the stop is waiting on ──────────────────────────────────────────────────────────────────
export type StopCounts = {
  status?: string | null; phase?: string | null; is_live_now?: boolean | null;
  tasks_open?: number | null; tasks_critical_open?: number | null;
  staff?: number | null; recap?: string | null; lat?: number | null;
};

/** One line for the top of the record. The loudest true thing, not a summary of everything. */
export function stopOwedLine(s: StopCounts | null | undefined): string {
  if (!s) return "";
  const crit = Number(s.tasks_critical_open ?? 0);
  const open = Number(s.tasks_open ?? 0);

  if (s.is_live_now && s.phase === "past") return "Still flagged live, and the window has closed.";
  if (s.is_live_now) return "Live now.";
  if (s.status === "done" || s.phase === "past") {
    if (s.status !== "done") return "The window has closed and this still reads upcoming.";
    return String(s.recap ?? "").trim() ? "Done and written up." : "Done. No after-action note yet.";
  }
  if (s.lat == null) return "No map pin — nobody can get directions to this.";
  if (crit > 0) return crit === 1 ? "1 critical job still open." : `${crit} critical jobs still open.`;
  if (Number(s.staff ?? 0) === 0) return "Nobody is on it yet.";
  if (open > 0) return open === 1 ? "1 job left." : `${open} jobs left.`;
  return "Nothing outstanding.";
}
