// THE PRESENTER'S THREE WAYS (IP1, 2026-10-27 — Ryan: "Yes, build IP1": Pitch tightening, an Explore sandbox — what-ifs
// held only in the viewer's browser, never saved — and Diligence drill-down to each figure's formula and sources, all
// inside the existing presenter, no migration). Pure, so every rule is tested in scripts/ip1.test.mjs.
//
//   · Pitch: the story, one message a slide. A plan's case becomes the ask and the return, then cash and the scenarios,
//     then the risks, then the evidence — each its own slide, so nothing on a projector is too small to read.
//   · Explore: the same approved case, with four levers a guest can move. The what-if lives in React state only — no
//     storage, no network, no write — and it's labelled as theirs, never as GT3's plan. Leaving it returns the approved case.
//   · Diligence: the whole case on one slide, every figure opens to its formula, its worked numbers, what it's made of,
//     and the accepted research behind the case, each with its source.
import type { MetricKey, Model } from "./visionMoney";
import { dollars } from "./finance";
import type { PlanCase } from "./visionCaseData";

export const PRESENT_MODES = ["pitch", "explore", "diligence"] as const;
export type PresentMode = (typeof PRESENT_MODES)[number];
export const MODE_WORD: Record<PresentMode, string> = { pitch: "Pitch", explore: "Explore", diligence: "Diligence" };
export const MODE_SAYS: Record<PresentMode, string> = {
  pitch: "The story, one point per slide.",
  explore: "Change the numbers yourself — nothing is saved.",
  diligence: "Open any figure to see how it's calculated.",
};

/** The parts a case is told in, in Pitch. Risks and evidence only when there are some; an incomplete case says what's missing on its first two. */
export type CasePart = "ask" | "cash" | "risks" | "evidence";
export const PART_WORD: Record<CasePart, string> = { ask: "The ask and the return", cash: "Cash and the scenarios", risks: "The risks we watch", evidence: "What the market says" };
export function caseParts(c: Pick<PlanCase, "research" | "risks">): CasePart[] {
  const out: CasePart[] = ["ask", "cash"];
  // The risks slide shows the open ones (lib/visionRisks keyRisks: open, or an assumption proved wrong).
  if (c.risks.some((r) => r.status === "open" || r.status === "wrong")) out.push("risks");
  if (c.research.length > 0) out.push("evidence");
  return out;
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const LEVERS = ["ordersPerDay", "avgOrderCents", "cogsPct", "rentCents", "startupPct", "sharePct"] as const;
export type Lever = (typeof LEVERS)[number];
export type Edits = Partial<Record<Lever, number>>;
export const LEVER_WORD: Record<Lever, string> = { ordersPerDay: "Orders a day", avgOrderCents: "Average order", cogsPct: "Cost of goods", rentCents: "Rent a month", startupPct: "Startup costs", sharePct: "Investor's share of sales" };
/** The levers that change a scenario's inputs (the rest change the startup lines or the deal's terms). */
const INPUT_LEVERS = ["ordersPerDay", "avgOrderCents", "cogsPct", "rentCents"] as const;

/** A lever's approved value, read from the case — never invented. Startup costs are 100% of the priced lines; the
 *  investor's share only exists under a revenue share. */
export function approvedOf(c: PlanCase, lever: Lever): number | null {
  if (lever === "startupPct") return 100;
  if (lever === "sharePct") return c.structure.kind === "rev_share" ? c.structure.sharePct : null;
  const v = (c.scenarios.base as Record<string, unknown>)[lever];
  return typeof v === "number" ? v : null;
}

/** A lever's range: half to one and a half times the approved value, in sensible steps. Null when the approved case has
 *  no value for it (nothing to move from — we never invent one). */
export function leverRange(lever: Lever, approved: number | null | undefined): { min: number; max: number; step: number } | null {
  if (approved == null || !Number.isFinite(approved)) return null;
  if (lever === "startupPct") return { min: 50, max: 150, step: 5 };
  if (lever === "sharePct") return approved > 0 ? { min: Math.max(0.5, Math.round(approved * 0.5 * 2) / 2), max: Math.round(approved * 1.5 * 2) / 2, step: 0.5 } : null;
  if (lever === "cogsPct") return { min: Math.max(0, Math.round(approved * 0.5)), max: Math.min(95, Math.round(approved * 1.5) || 10), step: 1 };
  if (lever === "ordersPerDay") return { min: Math.max(1, Math.round(approved * 0.5)), max: Math.max(2, Math.round(approved * 1.5)), step: 1 };
  if (approved <= 0) return null;
  const step = lever === "avgOrderCents" ? 25 : 5000;
  const snap = (v: number) => Math.max(step, Math.round(v / step) * step);
  return { min: snap(approved * 0.5), max: snap(approved * 1.5), step };
}

/** The approved case with the guest's what-if laid over it. A new object: the approved case is untouched. Four levers
 *  move the base scenario's inputs; "startup costs" scales every priced line but the reserve; "investor's share" changes
 *  only a revenue share's percentage. Nothing else can change, and the other scenarios stay as approved. */
export function whatIf(c: PlanCase, edits: Edits): PlanCase {
  const ok = (k: Lever) => typeof edits[k] === "number" && Number.isFinite(edits[k]);
  const keep: Record<string, number> = {};
  for (const k of INPUT_LEVERS) if (ok(k)) keep[k] = edits[k]!;
  const scale = ok("startupPct") && edits.startupPct !== 100 ? edits.startupPct! / 100 : null;
  const share = ok("sharePct") && c.structure.kind === "rev_share" && edits.sharePct !== c.structure.sharePct ? edits.sharePct! : null;
  if (!Object.keys(keep).length && scale == null && share == null) return c;
  let base: Record<string, unknown> = { ...c.scenarios.base, ...keep };
  if (scale != null && Array.isArray(base.uses)) base = { ...base, uses: (base.uses as { category?: string; unitCents?: number | null }[]).map((l) => (l.category === "reserve" || l.unitCents == null ? l : { ...l, unitCents: Math.round(l.unitCents * scale) })) };
  const structure = share != null && c.structure.kind === "rev_share" ? { ...c.structure, sharePct: share } : c.structure;
  return { ...c, structure, scenarios: { ...c.scenarios, base } };
}
export const isEdited = (e: Edits) => LEVERS.some((k) => typeof e[k] === "number");

/** What a figure is called in front of an investor (IP1.2, the editorial pass): plain words first, the exact meaning kept.
 *  The Money screen keeps the engine's own labels; Diligence shows both the formula and these. */
export const PRESENT_LABEL: Partial<Record<MetricKey, string>> = {
  startupSpend: "Cost to open", requiredFunding: "Minimum funding", breakEven: "Covers its costs from",
  breakEvenAfter: "Covers its costs, after the investor", payback: "Earns back the opening cost",
  paybackAfter: "Earns back the opening cost, after the investor", roiBusiness: "Return on the opening cost, 3 years",
  roiAfter: "Return after the investor, 3 years", investorReturn: "Investor's annual return", revenue: "Sales over three years",
  reserveNeeded: "Cash the first months use", reservePlanned: "Reserve held", fundingRaised: "Raised",
};

/** What Explore shows, before and after. */
export const EXPLORE_FIGURES: MetricKey[] = ["revenue", "requiredFunding", "breakEven", "payback", "investorReturn"];

// ── Diligence ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The figures a guest can open on the case slide, in the order they're shown. */
export const DILIGENCE_FIGURES: MetricKey[] = ["startupSpend", "requiredFunding", "breakEven", "payback", "roiBusiness", "revenue"];

// ── Headlines (IP1.2, the editorial pass): a slide's title says what its numbers mean, from the engine's own figures. ──
/** The ask's headline: the plan's bottom line, after the investor is paid. */
export function askHeadline(m: Model, structure: string): string {
  const inv = structure !== "none";
  const n = inv ? m.paybackAfterMonth : m.paybackMonth;
  if (m.startupSpend <= 0) return "Nothing to earn back — the plan opens without startup costs.";
  if (n) return `Earns back its opening cost by month ${n}${inv ? ", after paying the investor" : ""}.`;
  return `Doesn't earn back its opening cost within three years${inv ? " once the investor is paid" : ""}.`;
}

/** The cash headline: the low point, said plainly. */
export function cashHeadline(m: Model): string {
  const open = m.months[0].cumulative - m.months[0].net;
  let low = open, at = 0;
  m.months.forEach((x, i) => { if (x.cumulative < low) { low = x.cumulative; at = i + 1; } });
  return low >= 0 ? `In the plan, cash never falls below ${dollars(low)}.` : `In the plan, cash runs ${dollars(-low)} short in month ${at}.`;
}

