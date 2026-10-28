import { localToday } from "./dates";

// THE PRIMAL STANDARD (P1, 0456) — the words and the small rules the screens share with the database. The database is the
// judge (it refuses a pass without evidence, a self-review, a prohibited claim); these mirror it so a screen can say why
// before anyone presses a button, and so every view uses the same words for the same state.

export const PILLARS = ["stillness", "light", "fuel", "movement"] as const;
export type StdPillar = (typeof PILLARS)[number];
export const PILLAR_WORD: Record<StdPillar, string> = { stillness: "Stillness", light: "Light", fuel: "Fuel", movement: "Movement" };

export type Subject = "room" | "object" | "material";
export const SUBJECT_WORD: Record<Subject, string> = { room: "Room", object: "Object", material: "Material" };

export type Severity = "safety_critical" | "high" | "medium" | "low";
export const SEVERITY_WORD: Record<Severity, string> = { safety_critical: "Safety-critical", high: "High", medium: "Medium", low: "Low" };

export type EvidenceKind = "observed" | "measured" | "declared" | "inferred" | "illustrative";
export const EVIDENCE_KINDS: EvidenceKind[] = ["measured", "observed", "declared", "inferred", "illustrative"];
export const EVIDENCE_KIND_WORD: Record<EvidenceKind, string> = { observed: "Observed", measured: "Measured", declared: "Declared by the maker", inferred: "Inferred", illustrative: "Illustrative" };

export type Outcome = "pass" | "conditional" | "fail" | "unknown" | "not_applicable";
export const OUTCOME_WORD: Record<Outcome, string> = { pass: "Meets it", conditional: "Meets it with conditions", fail: "Doesn't meet it", unknown: "Unknown", not_applicable: "Not applicable" };
export const OUTCOME_TAG: Record<Outcome, string> = { pass: "k-tag ok", conditional: "k-tag gold", fail: "k-tag warn", unknown: "k-tag", not_applicable: "k-tag" };

/** P1.1 (0457): a judgement is proposed, then verified by an owner — independently, or by the owner who proposed it (said). */
export type Verification = "proposed" | "independent" | "self";
export const VERIFY_WORD: Record<Verification, string> = { proposed: "Proposed — waiting for an owner", independent: "Verified", self: "Self-verified" };
export const VERIFY_TAG: Record<Verification, string> = { proposed: "k-tag gold", independent: "k-tag ok", self: "k-tag" };

export type Version = { id: string; label: string; summary: string | null; status: "draft" | "published" | "retired"; published_at: string | null; created_at: string };
export type Criterion = { id: string; version_id: string; pillar: StdPillar; code: string; title: string; requirement: string; applies_to: Subject; severity: Severity; evidence_needed: string | null; required_measures: string[]; needs_task_population: boolean; sort: number;
  /** P1.1 (0457): weight within its pillar (1 = equal), mandatory, and the operating models it applies to (empty = all). */
  weight?: number; mandatory?: boolean; models?: string[] };
export type Material = { id: string; name: string; category: string; maker: string | null; product_ref: string | null; composition: string | null; watch_list: string[]; notes: string | null; archived_at: string | null };
export type ItemMaterial = { id: string; item_id: string; material_id: string; role: string | null };
export type Evidence = { id: string; subject_type: Subject; subject_id: string; criterion_id: string | null; bearing: "supports" | "contradicts" | "neutral"; kind: EvidenceKind; summary: string; source_title: string | null; source_url: string | null; source_date: string | null; method: string | null; coverage: string | null; limitations: string | null; confidence: "low" | "medium" | "high"; measures: Record<string, unknown>; expires_on: string | null; review_status: "submitted" | "accepted" | "rejected"; review_note: string | null; submitted_by: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string };
export type Assessment = { id: string; version_id: string; criterion_id: string; subject_type: Subject; subject_id: string; outcome: Outcome; hazard: string | null; exposure: string | null; risk: "low" | "medium" | "high" | "unknown"; task: string | null; population: string | null; evidence_ids: string[]; notes: string | null; assessed_by: string | null; assessed_at: string; stale_at: string | null; stale_reason: string | null; superseded_by: string | null;
  verification?: Verification; verified_by?: string | null; verified_at?: string | null; na_reason?: string | null; na_approved_by?: string | null; confidence?: "low" | "medium" | "high" | null };
export type Claim = { id: string; subject_type: string | null; subject_id: string | null; text: string; kind: "aspiration" | "marketing" | "scientific" | "medical"; status: "unverified" | "supported" | "not_supported"; evidence_ids: string[]; created_at: string };
export type Review = { id: string; subject_type: string; subject_id: string; reason: string; status: "open" | "closed"; created_at: string };

/** One evidence record's state, in the words every view uses. Unknown is never "safe": it's its own state. */
export type EvidenceState = "unreviewed" | "rejected" | "expired" | "illustrative" | EvidenceKind;
export function evidenceState(e: Pick<Evidence, "review_status" | "expires_on" | "kind">, today = localToday()): EvidenceState {
  if (e.review_status === "submitted") return "unreviewed";
  if (e.review_status === "rejected") return "rejected";
  if (e.expires_on && e.expires_on < today) return "expired";
  return e.kind;
}
export const STATE_WORD: Record<EvidenceState, string> = { unreviewed: "Not reviewed yet", rejected: "Rejected", expired: "Expired", illustrative: "Illustrative — not evidence", observed: "Observed", measured: "Measured", declared: "Declared by the maker", inferred: "Inferred" };
/** Evidence that can carry a pass: reviewed, accepted, in date, about something real. */
export const canCarryPass = (e: Pick<Evidence, "review_status" | "expires_on" | "kind" | "bearing">, today?: string) =>
  e.bearing === "supports" && !["unreviewed", "rejected", "expired", "illustrative"].includes(evidenceState(e, today));

/** The prohibited claims — the same patterns 0456's std_prohibited_claim refuses. A match never becomes "supported". */
export const PROHIBITED: RegExp[] = [/non[- ]?toxic/i, /toxin[- ]?free/i, /chemical[- ]?free/i, /zero (physiological )?stress/i, /universally (harmless|safe)/i, /detox/i,
  /prevents? (disease|illness|cancer)/i, /disease prevention/i, /\bcures?\b/i, /genome/i, /gene expression/i, /guaranteed (posture|circadian|health|sleep)/i, /100% safe/i, /completely harmless/i];
export const isProhibited = (text: string) => PROHIBITED.some((r) => r.test(text));

/** Why a pass would be refused — the database's reasons, said before the button. Empty when it could pass. */
export function passBlockers(c: Pick<Criterion, "required_measures" | "needs_task_population">, chosen: Pick<Evidence, "review_status" | "expires_on" | "kind" | "bearing" | "measures">[], against: number, task: string, population: string, today?: string): string[] {
  const good = chosen.filter((e) => canCarryPass(e, today));
  const out: string[] = [];
  if (!good.length) out.push("No accepted, in-date, non-illustrative evidence supports it — the honest outcome is unknown.");
  const have = new Set(good.flatMap((e) => Object.keys(e.measures ?? {})));
  const missing = c.required_measures.filter((m) => !have.has(m));
  if (missing.length) out.push(`Missing measurements: ${missing.join(", ")}.`);
  if (against > 0) out.push("Accepted evidence contradicts it — the evidence conflicts.");
  if (c.needs_task_population && (!task.trim() || !population.trim())) out.push("Name the task and who it's for.");
  return out;
}

/** "key=value, key=value" → measures. Numbers stay numbers. Bad pairs are dropped and named. */
export function parseMeasures(text: string): { measures: Record<string, number | string>; bad: string[] } {
  const measures: Record<string, number | string> = {}; const bad: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const pair = raw.trim(); if (!pair) continue;
    const m = /^([a-z][a-z0-9_]{0,39})\s*[=:]\s*(.+)$/i.exec(pair);
    if (!m) { bad.push(pair); continue; }
    const v = m[2].trim(); const n = Number(v);
    measures[m[1].toLowerCase()] = v !== "" && Number.isFinite(n) ? n : v.slice(0, 80);
  }
  return { measures, bad };
}

/** The summary for one subject — the worst first, so a total can't hide a safety-critical fail or a serious unknown. */
export type Summary = { passes: number; conditionals: number; fails: number; unknowns: number; stale: number; critical_fail: boolean; serious_unknown: boolean; not_applicable?: number; unverified?: number };
export function summaryWords(s: Summary | null | undefined): { tag: string; word: string } {
  if (!s) return { tag: "k-tag", word: "Not assessed" };
  if (s.critical_fail) return { tag: "k-tag warn", word: "Safety-critical failure" };
  if (s.fails) return { tag: "k-tag warn", word: `${s.fails} not met` };
  if (s.serious_unknown) return { tag: "k-tag gold", word: "Serious unknown" };
  if (s.stale) return { tag: "k-tag gold", word: `${s.stale} stale` };
  if (s.unknowns) return { tag: "k-tag", word: `${s.unknowns} unknown` };
  if (s.conditionals) return { tag: "k-tag gold", word: `Met · ${s.conditionals} with conditions` };
  return { tag: "k-tag ok", word: `Met · ${s.passes}` };
}
