// ONE MEANING OF PAYBACK, BREAK-EVEN AND ROI ACROSS GT3 (R54b — the 2026-10-25 traceability audit, gap 9: "payback and
// break-even defined three ways"; Ryan: "Yes, as its own patch"). Pure. The plan's money (lib/visionMoney), the operator
// deal (lib/dealExplainer) and an event's projection (lib/economics) all say these words; here is what each one means,
// once, and every engine calls it rather than writing its own loop.
//
//   PAYBACK — the first month by which the money that came back covers the money put in: Σ flows ≥ the investment.
//             Nothing put in → nothing to pay back (null). Never covered within the flows → not within them (null for a
//             horizon, Infinity for a steady rate that never comes back).
//   BREAK-EVEN (a month) — the first month from which every month to the end is at or above zero. Not the first good
//             month: a plan that dips again hasn't broken even.
//   BREAK-EVEN (units) — for one event, not a span of months: the units whose contribution covers its fixed costs.
//             A different question, said in guests and units, never in months.
//   ROI — (what came back − the basis) ÷ the basis, with the basis and the horizon always named beside it.

/** The month (1-based) by which Σ flows covers `investment`; null when nothing was put in or it isn't covered. */
export function paybackMonth(flows: readonly number[], investment: number): number | null {
  if (!(investment > 0)) return null;
  let back = 0;
  for (let k = 0; k < flows.length; k++) { back += flows[k]; if (back >= investment) return k + 1; }
  return null;
}

/** Payback at a steady monthly rate — the same rule over a constant flow: ⌈investment ÷ monthly⌉. Nothing put in → null;
 *  nothing coming back → Infinity (it never pays back, at any horizon). */
export function steadyPaybackMonths(investment: number, monthly: number): number | null {
  const c = Math.max(0, Math.round(Number(investment) || 0));
  if (c <= 0) return null;
  const m = Math.round(Number(monthly) || 0);
  if (m <= 0) return Infinity;
  return Math.ceil(c / m);
}

/** The first month (1-based) from which every flow to the end is ≥ 0; null when the last month is below zero. */
export function breakEvenMonth(flows: readonly number[]): number | null {
  let at: number | null = null;
  for (let k = flows.length - 1; k >= 0 && flows[k] >= 0; k--) at = k + 1;
  return at;
}

/** Units whose contribution covers the fixed costs; null when a unit contributes nothing (no number of them covers it). */
export function breakEvenUnits(fixedCents: number, contributionPerUnitCents: number): number | null {
  return contributionPerUnitCents > 0 ? fixedCents / contributionPerUnitCents : null;
}

/** (returned − basis) ÷ basis, as a fraction; null when there's no basis to measure against. */
export function roi(returned: number, basis: number): number | null {
  return basis > 0 ? (returned - basis) / basis : null;
}
