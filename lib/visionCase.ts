// THE INVESTOR CASE (R57, phase E — Ryan, 2026-10-25: "investor presentation with expiring share links… what investors
// want to see"). Pure. A plan's case is its owner-approved baseline — never the working what-ifs — run through the one
// engine (lib/visionMoney), its score (lib/visionScore) and its accepted research, each finding with its source. The
// presenter in the room and a private link both read it from here, so the slide and the Money screen can't disagree.
import { NO_ROOM, SCENARIOS, investor, project, toInputs, trace, type Context, type Inputs, type MetricKey, type Model, type Scenario, type Trace } from "./visionMoney";
import { score, type Score } from "./visionScore";
import { ASSUMED_SERVE_SEC, capacity } from "./visionRoom";
import type { Layout } from "./vision";
import type { PlanCase } from "./visionCaseData";

export { toCase, type CaseFinding, type PlanCase } from "./visionCaseData";

export type CaseFigures = { models: Record<Scenario, Model>; base: Record<MetricKey, Trace>; scores: Record<Scenario, Score>; irrPct: number | null;
  /** The investor's side under the structure, as the engine says it (IP1.1: what the investor receives, in words). */
  inv: ReturnType<typeof investor> | null };
/** The case, computed: the three scenarios under the structure, the base's traced figures, each scenario's score (the
 *  case's research counts as accepted — only accepted findings are ever in it), the investor's rate. The room's counter
 *  is read from the plan's room when the baseline caps sales by it. */
export function figuresOf(raw: PlanCase, room: Pick<Layout, "items"> | null = null): CaseFigures {
  const c = { ...raw, scenarios: Object.fromEntries(SCENARIOS.map((s) => [s, toInputs(raw.scenarios[s] as Partial<Inputs>)])) as Record<Scenario, Inputs> };
  const ctx = (x: Inputs): Context => (room ? { counterPerHour: capacity(room, x.serveSec ?? ASSUMED_SERVE_SEC).counterPerHour } : NO_ROOM);
  const models = Object.fromEntries(SCENARIOS.map((s) => [s, project(c.scenarios[s], c.structure, ctx(c.scenarios[s]))])) as Record<Scenario, Model>;
  const accepted = c.research.map((r) => ({ topic: r.topic, status: "accepted" as const, bearing: r.bearing, retrieved_at: r.retrieved_at }));
  const scores = Object.fromEntries(SCENARIOS.map((s) => [s, score(c.scenarios[s], models[s], accepted, s === "base" ? { conservative: models.conservative.ok ? models.conservative : null, acknowledged: c.acknowledged } : {})])) as Record<Scenario, Score>;
  const inv = models.base.ok && c.structure.kind !== "none" ? investor(models.base, c.structure) : null;
  return { models, base: trace(c.scenarios.base, c.structure, models.base), scores, irrPct: inv?.irrPct ?? null, inv };
}
