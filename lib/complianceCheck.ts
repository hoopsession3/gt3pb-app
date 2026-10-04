// RE-CHECKING A PERMIT RULE — the app's half of 0342 (2026-10-04).
//
// A compliance rule carries the date someone last confirmed it against the authority that issues
// it (0284), and when that date goes stale the rule lands under Needs you (0320). Nothing in the app
// could write the date, so nothing on that list could ever leave it. This file is the rule for what
// a re-check needs and the one place the two writes are made from:
//
//   · recheck — any staff member who checked it: "still true", dated today; or "it has changed",
//     which never rewrites the rule (nobody writes a permit requirement by summary), marks it
//     unconfirmed with what was heard and from whom, and tells the owners;
//   · correct — an owner or admin rewrites the rule from what the authority said.
//
// Every one of them needs WHERE it was checked. A check with no source is precisely what 0284 spent a
// migration removing: a rule that looks like knowledge and is not.
//
// The refusals here mirror the database's (recheck_compliance_rule / correct_compliance_rule) so the
// sheet can say what is missing before the round trip; scripts/db.compliance.test.mjs compiles this
// file and runs both over the same inputs, so they cannot disagree.

import type { SupabaseClient } from "@supabase/supabase-js";

/** What a person can report after checking. 'corrected' is the admin's rewrite. */
// vocab: compliance_checks.outcome
export const CHECK_OUTCOMES = ["confirmed", "changed", "corrected"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** How a deadline counts — the distinction 0284 found was worth a doubled fee. */
// vocab: compliance_rules.lead_basis
export const LEAD_BASES = ["business", "calendar"] as const;
export type LeadBasis = (typeof LEAD_BASES)[number];

const filled = (s: string | null | undefined) => (s ?? "").trim();

/** Why a re-check cannot be sent yet, in the database's words — or null when it can. */
export function recheckProblem(outcome: "confirmed" | "changed", checkedAgainst: string, note?: string | null): string | null {
  if (filled(checkedAgainst).length < 3) return "Say where you checked it — the county, the agency, the page or the person.";
  if (outcome === "changed" && filled(note).length < 3) return "Say what has changed, so the rule can be corrected.";
  return null;
}

export type Correction = {
  label: string; link: string; authority: string;
  leadDays: number | null; leadBasis: LeadBasis | null;
  checkedAgainst: string; note?: string | null;
};

/** Why a correction cannot be saved yet — or null when it can. */
export function correctionProblem(c: Correction): string | null {
  if (filled(c.label).length < 5) return "The rule needs its words.";
  if (filled(c.checkedAgainst).length < 3) return "Say where you checked it — the county, the agency, the page or the person.";
  if ((c.leadDays === null) !== (c.leadBasis === null)) return "A deadline needs both its number of days and whether they are business or calendar days.";
  if (c.leadDays !== null && (!Number.isInteger(c.leadDays) || c.leadDays < 0)) return "A deadline is a whole number of days, not negative.";
  return null;
}

/** "30 business days before" — or null when the rule has no deadline. */
export function deadlineWords(leadDays: number | null | undefined, leadBasis: string | null | undefined): string | null {
  if (leadDays == null) return null;
  const unit = leadBasis === "business" ? "business day" : leadBasis === "calendar" ? "calendar day" : "day";
  return `${leadDays} ${unit}${leadDays === 1 ? "" : "s"} before`;
}

/** When it was last confirmed, said the way the rest of the app says a date — or that it never was. */
export function lastCheckedWords(verifiedOn: string | null | undefined, today: string): string {
  if (!verifiedOn) return "Never dated — nobody recorded when this was confirmed";
  const d = new Date(`${verifiedOn}T12:00:00`), t = new Date(`${today}T12:00:00`);
  const days = Math.round((t.getTime() - d.getTime()) / 864e5);
  const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return days <= 0 ? `Confirmed ${when} — today` : `Confirmed ${when} — ${days} day${days === 1 ? "" : "s"} ago`;
}

// ── THE WRITES ─────────────────────────────────────────────────────────────────────────────────
// One RPC each (0342): the check row and the rule change land together, or neither does.

export async function recheckRule(sb: SupabaseClient, ruleId: string, outcome: "confirmed" | "changed",
  checkedAgainst: string, note?: string | null): Promise<{ error: string | null }> {
  const { error } = await sb.rpc("recheck_compliance_rule", {
    p_rule: ruleId, p_outcome: outcome, p_checked_against: checkedAgainst.trim(), p_note: filled(note) || null,
  });
  return { error: error ? error.message : null };
}

export async function correctRule(sb: SupabaseClient, ruleId: string, c: Correction): Promise<{ error: string | null }> {
  const { error } = await sb.rpc("correct_compliance_rule", {
    p_rule: ruleId, p_label: c.label.trim(), p_link: filled(c.link) || null, p_authority: filled(c.authority) || null,
    p_lead_days: c.leadDays, p_lead_basis: c.leadBasis,
    p_checked_against: c.checkedAgainst.trim(), p_note: filled(c.note) || null,
  });
  return { error: error ? error.message : null };
}
