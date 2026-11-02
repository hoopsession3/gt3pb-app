// WHETHER THE LINK CAN ANSWER THE PROPOSITION (IMS8 P12) — the cheap half of lib/proposition, so the presenter can decide
// whether the proposition slide exists without carrying the money model (lib/visionMoney) in its own bundle. The slide
// itself (components/vision/Proposition) loads only when it's shown. Exactly lib/proposition's `has` — that one is this.
import type { Vision } from "./visionRead";

export type PropositionHas = { funded: boolean; sought: boolean; uses: boolean; terms: boolean; milestones: boolean };

export function propositionHas(v: Pick<Vision, "programs" | "plans" | "asks" | "needs" | "deps" | "cases">): PropositionHas {
  const withCase = v.plans.filter((p) => v.cases?.[p.id]);
  return {
    funded: v.programs.length > 0,
    sought: v.asks.length > 0,
    // every row of a case's uses is a line (toLines maps unknown categories to "other"), so any row is a use to say
    uses: withCase.some((p) => { const u = (v.cases![p.id].scenarios.base as Record<string, unknown>)?.uses; return Array.isArray(u) && u.length > 0; }),
    terms: withCase.length > 0,
    milestones: v.plans.some((p) => !!p.gate?.trim() || v.needs.some((n) => n.plan_id === p.id && !n.done_on) || v.deps.some((d) => d.plan_id === p.id && v.plans.some((x) => x.id === d.needs_plan_id))),
  };
}
