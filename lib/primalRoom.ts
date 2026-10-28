import type { Assessment, Criterion, ItemMaterial } from "./standard";
import type { Determination, ScoreCriterion } from "./primalScore";

// A ROOM'S DETERMINATIONS (P1.1) — what the Primal Significance Score reads for one location: each criterion of the
// published version, judged on the room itself, on the objects in it, or on the materials those objects are made of.
// Several objects or materials under one criterion: the worst current judgement stands for all of them, and it is
// verified only when every one is. A criterion with nothing judged under it is left out of the list — the score counts
// it as not assessed (zero), never as met. Pure; worked by hand in scripts/p11.test.mjs.

const RANK: Record<string, number> = { fail: 0, unknown: 1, conditional: 2, pass: 3, not_applicable: 4 };

export function toScoreCriteria(criteria: readonly Criterion[]): ScoreCriterion[] {
  return criteria.map((c) => ({ id: c.id, pillar: c.pillar, code: c.code, title: c.title, weight: Number(c.weight ?? 1) || 1,
    mandatory: !!c.mandatory, severity: c.severity, models: c.models ?? [] }));
}

export function roomDeterminations(criteria: readonly Criterion[], current: readonly Assessment[], roomId: string, objectIds: readonly string[], links: readonly ItemMaterial[]): Determination[] {
  const objects = new Set(objectIds);
  const materials = new Set(links.filter((l) => objects.has(l.item_id)).map((l) => l.material_id));
  const out: Determination[] = [];
  for (const c of criteria) {
    const under = current.filter((a) => a.criterion_id === c.id && !a.superseded_by && (
      (c.applies_to === "room" && a.subject_type === "room" && a.subject_id === roomId)
      || (c.applies_to === "object" && a.subject_type === "object" && objects.has(a.subject_id))
      || (c.applies_to === "material" && a.subject_type === "material" && materials.has(a.subject_id))));
    if (!under.length) continue;
    // Every subject the criterion reaches must be judged, or the criterion is unknown for the room.
    const reach = c.applies_to === "room" ? 1 : c.applies_to === "object" ? objects.size : materials.size;
    const judged = new Set(under.map((a) => a.subject_id)).size;
    const worst = [...under].sort((a, b) => (RANK[a.outcome] ?? 1) - (RANK[b.outcome] ?? 1))[0];
    const allNa = under.every((a) => a.outcome === "not_applicable" && a.na_approved_by);
    const outcome = judged < reach ? "unknown" : allNa ? "not_applicable" : worst.outcome === "not_applicable" ? "unknown" : worst.outcome;
    const verified = under.every((a) => a.verification === "independent") ? "independent" : under.every((a) => a.verification === "independent" || a.verification === "self") ? "self" : "no";
    const conf = under.map((a) => a.confidence).filter(Boolean) as ("low" | "medium" | "high")[];
    out.push({
      criterion_id: c.id, outcome, verified,
      // The database refused a pass or a with-conditions without accepted evidence; a not-met is a determination in itself.
      evidenced: outcome === "pass" || outcome === "conditional" || outcome === "fail" || outcome === "not_applicable",
      naReason: allNa ? under[0].na_reason ?? null : null, naApprovedBy: allNa ? under[0].na_approved_by ?? null : null,
      stale: under.some((a) => !!a.stale_at),
      confidence: conf.includes("low") ? "low" : conf.includes("medium") ? "medium" : conf.length ? "high" : undefined,
    });
  }
  return out;
}
