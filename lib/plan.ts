// PLAN GATE — pure feature-entitlement math for software billing (audit #2). Which plan unlocks
// what, and whether a tenant's billing state still counts as paid. Deterministic and smoke-tested;
// routes/components call planAllows()/planActive() rather than sprinkling plan strings around.
// GT3 is the 'founder' tenant: everything, forever, never billed.

export type Plan = "founder" | "solo" | "pro";
export type Feature =
  | "ai_agents"       // the operator AI layer (the moat)
  | "wallet_cards"    // Apple/Google membership cards
  | "truck_display"   // /display loop
  | "multi_user"      // more than one staff seat
  | "reports";        // money reports / P&L / snapshot

const SOLO: Feature[] = ["truck_display", "reports"];
const ALL: Feature[] = ["ai_agents", "wallet_cards", "truck_display", "multi_user", "reports"];
const MATRIX: Record<Plan, ReadonlySet<Feature>> = {
  founder: new Set(ALL),
  pro: new Set(ALL),
  solo: new Set(SOLO),
};

// Unknown/missing plan reads as the most-restricted tier — a bad value can gate features off,
// never unlock them.
export function planAllows(plan: string | null | undefined, feature: Feature): boolean {
  const p: Plan = plan === "founder" || plan === "pro" || plan === "solo" ? plan : "solo";
  return MATRIX[p].has(feature);
}

// Is the tenant's subscription in good standing? founder is always active; past_due gets a grace
// window (card retries), canceled rides out the already-paid period.
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export function planActive(input: { plan: string | null | undefined; billing_status: string | null | undefined; current_period_end: string | null | undefined }, nowMs: number): boolean {
  if (input.plan === "founder") return true;
  const end = input.current_period_end ? Date.parse(input.current_period_end) : NaN;
  switch (input.billing_status) {
    case "active":
    case "trialing":
      return true;
    case "past_due":
      return Number.isFinite(end) ? nowMs <= end + GRACE_MS : false;
    case "canceled":
      return Number.isFinite(end) ? nowMs <= end : false;
    default:
      return false;
  }
}
