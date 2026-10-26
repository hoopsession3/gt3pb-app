import { PILLARS, type StdPillar } from "./standard";

// THE PRIMAL SIGNIFICANCE SCORE — DRAFT METHOD 0.1 (2026-10-26; Ryan approved building it as a draft: "provisional,
// owners-only, unpublished until you approve the method version"). Pure, so every number is worked by hand in
// scripts/primalscore.test.mjs. Nothing here decides an outcome — it adds up determinations people made (P1.1: proposed
// by an assessor, verified by someone else, or "self-verified" and labelled) and says how much of the total rests on proof.
//
// The rules, in order:
//   · Only criteria that apply to the location's operating model count. "Not applicable" needs a reason and an approver,
//     or it isn't accepted — the criterion stays in, as unknown.
//   · Per criterion: meets it = full points; with conditions = half; doesn't meet it = 0; unknown, unverified-and-not-
//     proposed, or expired = 0. An unknown is never dropped from the total (that would reward not measuring).
//   · Per pillar: points earned ÷ points possible × 100, criteria weighted within the pillar (equal until set).
//   · Overall: the pillars weighted (25 each until approved), over the pillars that have any criteria.
//   · Gates override the number: a mandatory criterion not met, or a safety-critical unknown → "Not certifiable".
//     Verified only when every scored criterion is verified (by another person; or self-verified, said) and in date.
//   · Beside the score, never inside it: evidence coverage, confidence, the method's and the Standard's versions.
export const METHOD = { version: "0.1-draft", approved: false } as const;
export const PILLAR_WEIGHT: Record<StdPillar, number> = { stillness: 25, light: 25, fuel: 25, movement: 25 };

export type ScoreCriterion = {
  id: string; pillar: StdPillar; code: string; title: string;
  /** Weight within its pillar (1 = equal). */
  weight?: number;
  mandatory: boolean;
  severity: "safety_critical" | "high" | "medium" | "low";
  /** The operating models it applies to; empty = all. */
  models?: string[];
};
export type Determination = {
  criterion_id: string;
  outcome: "pass" | "conditional" | "fail" | "unknown" | "not_applicable";
  /** P1.1: a proposal not yet verified counts as unverified — scored, but the result is provisional. */
  verified: "independent" | "self" | "no";
  /** Accepted, in-date evidence behind it (false: none, or expired / rejected since). */
  evidenced: boolean;
  /** For not_applicable: why, and who approved it. */
  naReason?: string | null; naApprovedBy?: string | null;
  stale?: boolean;
  confidence?: "low" | "medium" | "high";
};
export type CriterionResult = { criterion: ScoreCriterion; status: "met" | "conditional" | "not_met" | "unknown" | "not_applicable"; points: number; possible: number; why: string; counts: boolean };
export type PillarResult = { pillar: StdPillar; score: number | null; earned: number; possible: number; criteria: CriterionResult[] };
export type PrimalScore = {
  method: typeof METHOD; standardVersion: string | null; model: string;
  overall: number | null; pillars: PillarResult[];
  status: "verified" | "provisional" | "not_certifiable" | "not_assessed";
  gates: string[]; coverage: number; confidence: "low" | "medium" | "high" | null;
  selfVerified: boolean; excluded: { code: string; reason: string }[];
  /** What would raise the verified score most: criterion, and how many overall points it could add. */
  next: { code: string; title: string; gain: number; action: string }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function primalScore(criteria: readonly ScoreCriterion[], dets: readonly Determination[], model: string, standardVersion: string | null = null): PrimalScore {
  const byId = new Map(dets.map((d) => [d.criterion_id, d]));
  const applies = criteria.filter((c) => !c.models?.length || c.models.includes(model));
  const excluded: { code: string; reason: string }[] = [];
  const gates: string[] = [];
  let evidenced = 0, verifiedAll = true, selfVerified = false, scoredCount = 0;
  const conf: number[] = [];

  const results: CriterionResult[] = applies.map((c) => {
    const d = byId.get(c.id);
    const w = c.weight ?? 1;
    // Not applicable: only with a reason and an approver; otherwise it stays in, as unknown.
    if (d?.outcome === "not_applicable") {
      if (d.naReason?.trim() && d.naApprovedBy) { excluded.push({ code: c.code, reason: d.naReason.trim() }); return { criterion: c, status: "not_applicable", points: 0, possible: 0, why: `Not applicable: ${d.naReason.trim()}`, counts: false }; }
    }
    scoredCount++;
    const usable = !!d && d.outcome !== "not_applicable" && d.evidenced && !d.stale;
    if (usable) evidenced++;
    if (!usable || d!.verified === "no") verifiedAll = false;
    if (usable && d!.verified === "self") selfVerified = true;
    if (usable && d!.confidence) conf.push(d!.confidence === "high" ? 3 : d!.confidence === "medium" ? 2 : 1);
    const outcome = usable ? d!.outcome : "unknown";
    // Gates.
    if (c.mandatory && outcome === "fail") gates.push(`${c.code} is mandatory and not met.`);
    if (c.severity === "safety_critical" && outcome === "unknown") gates.push(`${c.code} is safety-critical and unknown.`);
    if (outcome === "pass") return { criterion: c, status: "met", points: w, possible: w, why: "Met, with accepted evidence.", counts: true };
    if (outcome === "conditional") return { criterion: c, status: "conditional", points: w / 2, possible: w, why: "Met with conditions — half its points.", counts: true };
    if (outcome === "fail") return { criterion: c, status: "not_met", points: 0, possible: w, why: "Not met.", counts: true };
    const why = !d ? "Not assessed — counts as zero." : d.stale ? "Its judgement is stale — counts as zero until reassessed." : !d.evidenced ? "No accepted, in-date evidence — counts as zero." : d.outcome === "not_applicable" ? "Marked not applicable without a reason and an approver — counts as zero." : "Unknown — counts as zero.";
    return { criterion: c, status: "unknown", points: 0, possible: w, why, counts: true };
  });

  const pillars: PillarResult[] = PILLARS.map((p) => {
    const cs = results.filter((x) => x.criterion.pillar === p);
    const earned = cs.reduce((n, x) => n + x.points, 0), possible = cs.reduce((n, x) => n + x.possible, 0);
    return { pillar: p, criteria: cs, earned, possible, score: possible > 0 ? r1((earned / possible) * 100) : null };
  });
  const live = pillars.filter((p) => p.score != null);
  const wsum = live.reduce((n, p) => n + PILLAR_WEIGHT[p.pillar], 0);
  const overall = live.length ? r1(live.reduce((n, p) => n + p.score! * PILLAR_WEIGHT[p.pillar], 0) / wsum) : null;
  const coverage = scoredCount ? Math.round((evidenced / scoredCount) * 100) : 0;
  const status: PrimalScore["status"] = overall == null ? "not_assessed" : gates.length ? "not_certifiable" : verifiedAll ? "verified" : "provisional";
  const confidence = conf.length ? (conf.reduce((a, b) => a + b, 0) / conf.length >= 2.5 ? "high" : conf.reduce((a, b) => a + b, 0) / conf.length >= 1.5 ? "medium" : "low") : null;
  // What would raise it most: each criterion's room to rise, weighted within its pillar, × the pillar's share.
  const next = results.filter((x) => x.counts && x.points < x.possible).map((x) => {
    const pr = pillars.find((p) => p.pillar === x.criterion.pillar)!;
    const gain = r1(((x.possible - x.points) / pr.possible) * 100 * (PILLAR_WEIGHT[x.criterion.pillar] / wsum));
    const action = x.status === "not_met" ? "Fix it, then reassess." : x.status === "conditional" ? "Meet the conditions, then reassess." : "Gather evidence and have it assessed and verified.";
    return { code: x.criterion.code, title: x.criterion.title, gain, action };
  }).sort((a, b) => b.gain - a.gain).slice(0, 3);
  return { method: METHOD, standardVersion, model, overall, pillars, status, gates, coverage, confidence, selfVerified, excluded, next };
}
