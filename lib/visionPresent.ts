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
import type { MetricKey } from "./visionMoney";
import type { PlanCase } from "./visionCaseData";

export const PRESENT_MODES = ["pitch", "explore", "diligence"] as const;
export type PresentMode = (typeof PRESENT_MODES)[number];
export const MODE_WORD: Record<PresentMode, string> = { pitch: "Pitch", explore: "Explore", diligence: "Diligence" };
export const MODE_SAYS: Record<PresentMode, string> = {
  pitch: "The story, one message a slide.",
  explore: "Move the numbers yourself — nothing is saved.",
  diligence: "Open any figure to see how it's worked out.",
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
export const LEVERS = ["ordersPerDay", "avgOrderCents", "cogsPct", "rentCents"] as const;
export type Lever = (typeof LEVERS)[number];
export type Edits = Partial<Record<Lever, number>>;
export const LEVER_WORD: Record<Lever, string> = { ordersPerDay: "Orders a day", avgOrderCents: "Average order", cogsPct: "Cost of goods", rentCents: "Rent a month" };

/** A lever's range: half to one and a half times the approved value, in sensible steps. Null when the approved case has
 *  no value for it (nothing to move from — we never invent one). */
export function leverRange(lever: Lever, approved: number | null | undefined): { min: number; max: number; step: number } | null {
  if (approved == null || !Number.isFinite(approved)) return null;
  if (lever === "cogsPct") return { min: Math.max(0, Math.round(approved * 0.5)), max: Math.min(95, Math.round(approved * 1.5) || 10), step: 1 };
  if (lever === "ordersPerDay") return { min: Math.max(1, Math.round(approved * 0.5)), max: Math.max(2, Math.round(approved * 1.5)), step: 1 };
  if (approved <= 0) return null;
  const step = lever === "avgOrderCents" ? 25 : 5000;
  const snap = (v: number) => Math.max(step, Math.round(v / step) * step);
  return { min: snap(approved * 0.5), max: snap(approved * 1.5), step };
}

/** The approved case with the guest's what-if laid over its base scenario. A new object: the approved case is untouched.
 *  Only the four levers can change, and only on the base. */
export function whatIf(c: PlanCase, edits: Edits): PlanCase {
  const keep: Edits = {};
  for (const k of LEVERS) if (typeof edits[k] === "number" && Number.isFinite(edits[k])) keep[k] = edits[k];
  if (!Object.keys(keep).length) return c;
  return { ...c, scenarios: { ...c.scenarios, base: { ...c.scenarios.base, ...keep } } };
}
export const isEdited = (e: Edits) => LEVERS.some((k) => typeof e[k] === "number");

/** What Explore shows, before and after. */
export const EXPLORE_FIGURES: MetricKey[] = ["revenue", "requiredFunding", "breakEven", "payback"];

// ── Diligence ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The figures a guest can open on the case slide, in the order they're shown. */
export const DILIGENCE_FIGURES: MetricKey[] = ["startupSpend", "requiredFunding", "breakEven", "payback", "roiBusiness", "revenue"];
