// THE INVESTOR CASE (R57, phase E — Ryan, 2026-10-25: "investor presentation with expiring share links… what investors
// want to see"). Pure. A plan's case is its owner-approved baseline — never the working what-ifs — run through the one
// engine (lib/visionMoney), its score (lib/visionScore) and its accepted research, each finding with its source. The
// presenter in the room and a private link both read it from here, so the slide and the Money screen can't disagree.
import { NO_ROOM, SCENARIOS, investor, project, sensitivity, toInputs, trace, type Context, type Inputs, type MetricKey, type Model, type Scenario, type Swing, type Trace } from "./visionMoney";
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

// ── IP1.4: the case's cash, reconciled — arithmetic on the engine's own outputs, never a second model ─────────────────
/** One month of the cash schedule, as the engine wrote it (month 0 is opening day: startup paid, nothing sold yet). */
/** costs = every operating cash cost of the month: goods, card fees, staff, rent, other, marketing (sales − operating cash). */
export type MonthRow = { m: number; opening: number; cashIn: number; costs: number; capex: number; toInvestor: number; closing: number };
export function monthRows(m: Model): MonthRow[] {
  if (!m.ok || !m.months.length) return [];
  const open = m.months[0].cumulative - m.months[0].net;
  return [{ m: 0, opening: m.fundingRaised, cashIn: 0, costs: 0, capex: m.startupSpend, toInvestor: 0, closing: open },
    ...m.months.map((x, k) => ({ m: k + 1, opening: x.cumulative - x.net, cashIn: x.revenue, costs: x.revenue - x.operating, capex: 0, toInvestor: x.toInvestor, closing: x.cumulative }))];
}
/** Where cash sits against the reserve the plan holds: above it, into it, or below zero. */
export function reserveStatus(closing: number, reserve: number): { word: string; level: "ok" | "into" | "short" } {
  if (closing < 0) return { word: `${fmt(-closing)} short — below zero`, level: "short" };
  if (reserve > 0 && closing < reserve) return { word: `${fmt(reserve - closing)} into the ${fmt(reserve)} reserve`, level: "into" };
  return { word: reserve > 0 ? `${fmt(closing - reserve)} above the ${fmt(reserve)} reserve` : "above zero (no reserve set)", level: "ok" };
}
const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

/** The figures that must agree, each with its arithmetic — Diligence shows these so an investor can redo them. */
export type Check = { label: string; formula: string; value: number; agrees: boolean };
export function checksOf(f: CaseFigures): Check[] {
  const b = f.models.base;
  if (!b.ok) return [];
  const rows = monthRows(b), open = rows[0].closing, low = Math.min(...rows.map((r) => r.closing)), last = rows[rows.length - 1].closing;
  const net = b.months.reduce((n, x) => n + x.net, 0), paid = b.months.reduce((n, x) => n + x.toInvestor, 0);
  const near = (a: number, z: number) => Math.abs(a - z) <= 1;   // within a cent: the engine rounds month by month
  return [
    { label: "Cash on opening day", formula: `raised ${fmt(b.fundingRaised)} − opening cost ${fmt(b.startupSpend)}`, value: open, agrees: near(open, b.fundingRaised - b.startupSpend) },
    { label: "Lowest cash", formula: `opening ${fmt(open)} − the early months' shortfall ${fmt(b.reserveNeeded)}`, value: low, agrees: near(low, open - b.reserveNeeded) },
    { label: "Minimum funding (cash never below zero)", formula: `opening cost ${fmt(b.startupSpend)} + the early months' shortfall ${fmt(b.reserveNeeded)}`, value: b.requiredFunding, agrees: near(b.requiredFunding, b.startupSpend + b.reserveNeeded) },
    { label: "Raised above that minimum", formula: `raised ${fmt(b.fundingRaised)} − minimum ${fmt(b.requiredFunding)} — the same as the lowest cash`, value: b.fundingRaised - b.requiredFunding, agrees: near(b.fundingRaised - b.requiredFunding, low) },
    // The engine rounds each month's cash to the cent, so 36 months can drift by a few cents; agreeing means to the dollar.
    { label: "Cash after three years", formula: `opening ${fmt(open)} + 36 months of sales − costs − investor payments (${fmt(net)})${Math.abs(last - open - net) >= 1 ? ` — ${Math.abs(Math.round(last - open - net))}¢ apart from the engine's month-by-month rounding` : ""}`, value: last, agrees: Math.abs(last - (open + net)) < 100 },
    ...(f.inv && f.inv.kind !== "none" ? [{ label: "Paid to the investor, 36 months", formula: "the sum of every month's payment", value: paid, agrees: near(paid, f.inv.returned) }] : []),
  ];
}
/** The base case's swings, ±pct on each driver — the engine's sensitivity on the approved inputs, with the room's counter. */
export function swingsOf(raw: PlanCase, room: Pick<Layout, "items"> | null = null, pct = 20): Swing[] {
  const i = toInputs(raw.scenarios.base as Partial<Inputs>);
  return sensitivity(i, pct, room ? { counterPerHour: capacity(room, i.serveSec ?? ASSUMED_SERVE_SEC).counterPerHour } : NO_ROOM);
}
