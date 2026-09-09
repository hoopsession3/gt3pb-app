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

// ── when a stop is over ─────────────────────────────────────────────────────────────────────────
// A stop's status column is not the whole answer: one nobody remembered to close is still over once
// its start time is far enough behind us. "Far enough" was eight hours in THREE places:
//
//   app/crew/page.tsx        OWNERDET_STOP_GRACE_MS = 8 * 3600 * 1000  + its own derivedStopStatus
//   components/FieldOpSheet  STOP_GRACE_MS          = 8 * 3600 * 1000  + a line-identical copy
//   components/PrepBoard     STOP_GRACE_MS          = 8 * 3600 * 1000  + isStopPast, the same rule
//                                                                        written a third way
//
// The two derivedStopStatus copies were identical apart from the constant's name. This file's own
// header explains why that matters — a second copy of whenLabel is how "16 Days Ago" comes back on
// one screen and not the other — and the argument is stronger here, because this decides whether a
// stop reads as DONE. Change the grace in one file and the same stop is finished on the detail
// sheet and still upcoming on the board.
//
// They HAD already drifted, in the smallest possible way: derivedStopStatus used `now - t > GRACE`,
// isStopPast used `t <= now - GRACE`, and those disagree at exactly the eight-hour mark. One
// instant, no practical consequence — and exactly the kind of divergence three copies produce for
// free. Strictly-greater wins, because that is what the status a person SEES was already using.
export const STOP_DONE_GRACE_MS = 8 * 3600 * 1000;

/** Has this stop's start slipped far enough behind us to count as over? */
export const isStopPast = (startsAt: string | null | undefined): boolean =>
  !!startsAt && Date.now() - new Date(startsAt).getTime() > STOP_DONE_GRACE_MS;

/**
 * The status to SHOW for a stop: the column when it is decisive, otherwise derived from the clock.
 * An explicit 'done', or a completed_at, always wins — a stop somebody closed early is closed.
 */
export function derivedStopStatus(
  status: string | null | undefined,
  startsAt: string | null | undefined,
  completedAt: string | null | undefined,
): string {
  if (status === "done" || completedAt) return "done";
  if (!startsAt) return "upcoming";
  return isStopPast(startsAt) ? "done" : "upcoming";
}

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

const QUALIFIER_TAIL =
  /(?:^|[\s—–\-·|,])(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekly|mornings?|evenings?|nights?|lunch|brunch|am|pm)\.?$/i;

/**
 * A stop name that is the venue's name PLUS a place or a slot — "Wine Express — Five Forks",
 * "X Saturday" — is the schema asking for a vendor_location or a recurring slot, not a typo.
 *
 * ── THIS WAS WRONG IN 0315 AND THE COMMENT ABOVE IT PROVED IT ─────────────────────────────────
 * The first version tested substring containment: is the venue's name inside the stop's, with more
 * on top? It shipped with a comment naming "Wine Express — Five Forks" as the case it existed for.
 * Run against that exact pair it returns FALSE — because the venue row spells it "WineXpress", one
 * word, and the stop spells it "Wine Express", two. Normalised, that is "winexpress" against
 * "wineexpress": one letter apart, so not a substring. All three of the live name_drift rows came
 * back unqualified, and the branch never fired on any real data.
 *
 * Same mistake as the contrast measurement earlier in this audit: I reasoned about a measurement
 * instead of taking it. The pairs are now in scripts/smoke.cjs by name, so this cannot claim to
 * handle a name it does not handle.
 *
 * What actually distinguishes the three, and does not depend on the venue's spelling — which is the
 * unreliable half:
 *     "Wine Express — Five Forks"   a dash, then a place        → a location
 *     "Wine Express Saturday"       ends in a day               → a recurring slot
 *     "Restore Hyper Wellness"      neither; the extra word is  → a different name, not a qualifier
 *                                   inside the name
 * Containment is kept as a second route, for the easy case where the two spellings do agree.
 */
export function looksLocationQualified(stored: string | null | undefined, canonical: string | null | undefined): boolean {
  const a = (stored ?? "").trim();
  const b = (canonical ?? "").trim();
  if (!a || !b || a === b) return false;

  // 1. a trailing slot word — "… Saturday", "… nights"
  if (QUALIFIER_TAIL.test(a)) return true;
  // 2. a separator with something after it — "… — Five Forks". Requires the separator to be
  //    surrounded by space, so a hyphenated single name ("Sit-Down") is not read as qualified.
  if (/\S\s+[—–|·]\s+\S/.test(a) || /\S\s+-\s+\S/.test(a)) return true;
  // 3. the clean case: the venue's name really is inside the stop's, with more on top
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a).length > norm(b).length && norm(a).includes(norm(b));
}

/**
 * THE NAME QUESTION, IN ONE PLACE (0316).
 *
 * 0315 put this reasoning inline in StopRecord and left the LIST above it on a static sentence. So
 * the deployed list reported that three stops disagreed with their venue without saying what either
 * one said, and handed all three the location-qualified advice when only two had a
 * location-qualified name — "Restore Hyper Wellness" against "Restore Wellness" differs by a word,
 * not by a suffix, and telling its owner to add a second location is telling them the wrong thing.
 *
 * Two surfaces, one rule, one of them wrong. So the rule lives here and both call it.
 *
 * `detail` states the disagreement and takes no side. `fix` branches, because those two names are
 * not the same problem. Returns null when there is nothing to say — an explanation nobody needs is
 * noise, and that decision belongs here too rather than in each caller.
 */
export function nameDriftAdvice(
  stored: string | null | undefined,
  canonical: string | null | undefined,
): { detail: string; fix: string; qualified: boolean } | null {
  const line = nameDriftLine(stored, canonical);
  if (!line) return null;
  const qualified = looksLocationQualified(stored, canonical);
  return {
    detail: `${line} Guests see the stop's.`,
    fix: qualified
      ? "That is the venue's name plus a location or a day, which usually means the venue needs a second location on file — not that the stop needs renaming."
      : "Decide which is right, then fix it on the stop or on the venue.",
    qualified,
  };
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
