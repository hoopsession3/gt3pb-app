// MENU & ECONOMICS (MEN1, 0460) — pure, deterministic. One catalog (public.products); a serving's ingredient cost from
// its bill of materials (lib/cogs, never stored); packaging, the vessel, waste and service time from
// product_unit_assumptions, each with its basis; card fees from the plan's money (lib/visionMoney). What isn't known is
// said to be unknown — never zeroed, never called profit.
//
//   Contribution per serving = price − ingredients − packaging/vessel − waste − card fees (− service labour, when known).
//   It is not gross profit, operating profit or cash: rent, salaries, equipment and everything fixed sit below it.

export type Basis = "actual" | "estimated" | "scenario";
export type ServiceBasis = "measured" | "estimated" | "unvalidated";
export const BASIS_WORD: Record<Basis | ServiceBasis | "unknown", string> = {
  actual: "Actual", estimated: "Estimated", scenario: "Scenario", measured: "Measured", unvalidated: "Unvalidated", unknown: "Unknown",
};

/** A serving size, said in fluid ounces; every economics figure can also be read per 10 oz — the bar's pour. */
export const POUR_OZ = 10;

export type Assumptions = {
  packaging_cents: number | null; packaging_basis: Basis | null; vessel: string | null;
  reusable: boolean; return_pct: number | null; loss_pct: number | null; wash_cents: number | null; vessel_cents: number | null;
  waste_pct: number | null; waste_basis: Basis | null;
  service_seconds: number | null; service_basis: ServiceBasis | null;
  source: string | null; as_of: string | null;
};
export const NO_ASSUMPTIONS: Assumptions = {
  packaging_cents: null, packaging_basis: null, vessel: null, reusable: false, return_pct: null, loss_pct: null, wash_cents: null, vessel_cents: null,
  waste_pct: null, waste_basis: null, service_seconds: null, service_basis: null, source: null, as_of: null,
};

/** A reusable glass, per use: the wash, plus the share of glasses lost spread over the uses a glass lasts.
 *  Unknown if any of the three (wash, loss, a glass's price) is unknown. */
export function reusablePerUse(a: Pick<Assumptions, "wash_cents" | "loss_pct" | "vessel_cents">): number | null {
  if (a.wash_cents == null || a.loss_pct == null || a.vessel_cents == null) return null;
  return Math.round(a.wash_cents + (a.vessel_cents * a.loss_pct) / 100);
}

export type Line = { key: "ingredients" | "packaging" | "waste" | "fees" | "labour"; label: string; cents: number | null; basis: string; note?: string };
export type Contribution = {
  priceCents: number;
  lines: Line[];
  /** price − the known lines; null when an essential line (ingredients, packaging) is unknown. */
  contributionCents: number | null;
  marginPct: number | null;
  /** What is unknown, by name — shown beside the figure, never hidden. */
  missing: string[];
  complete: boolean;
};

/** Contribution per serving. `ingredients` from lib/cogs (drinkCogs): uncosted lines count as unknown. Labour is
 *  included only when an hourly cost and a service time are both known; otherwise it is named as missing, and the
 *  figure is contribution before labour. */
export function contribution(p: {
  priceCents: number;
  ingredients: { cents: number; uncosted: number; hasRecipe: boolean } | null;
  a: Assumptions;
  cardFeePct: number | null;
  labourCentsPerHour?: number | null;
}): Contribution {
  const missing: string[] = [];
  const ing = p.ingredients;
  const ingCents = !ing || !ing.hasRecipe || ing.uncosted > 0 ? null : ing.cents;
  if (!ing || !ing.hasRecipe) missing.push("ingredients (no bill of materials)");
  else if (ing.uncosted > 0) missing.push(`ingredients (${ing.uncosted} without a cost)`);
  const pack = p.a.reusable ? reusablePerUse(p.a) : p.a.packaging_cents;
  if (pack == null) missing.push(p.a.reusable ? "the reusable glass (wash, loss or price)" : "packaging and vessel");
  const wasteCents = p.a.waste_pct == null || ingCents == null ? null : Math.round((ingCents * p.a.waste_pct) / 100);
  if (p.a.waste_pct == null) missing.push("waste");
  const fees = p.cardFeePct == null ? null : Math.round((p.priceCents * p.cardFeePct) / 100);
  if (p.cardFeePct == null) missing.push("card fees");
  const labour = p.a.service_seconds != null && p.labourCentsPerHour != null ? Math.round((p.labourCentsPerHour * p.a.service_seconds) / 3600) : null;
  if (labour == null) missing.push("service labour");
  const lines: Line[] = [
    { key: "ingredients", label: "Ingredients", cents: ingCents, basis: ingCents == null ? "unknown" : "actual", note: "from the bill of materials and inventory costs" },
    { key: "packaging", label: p.a.reusable ? "Reusable glass, per use" : "Packaging and vessel", cents: pack, basis: pack == null ? "unknown" : (p.a.packaging_basis ?? "estimated") },
    { key: "waste", label: "Waste", cents: wasteCents, basis: p.a.waste_basis ?? "unknown", note: p.a.waste_pct != null ? `${p.a.waste_pct}% of ingredients` : undefined },
    { key: "fees", label: "Card fees", cents: fees, basis: fees == null ? "unknown" : "estimated", note: p.cardFeePct != null ? `${p.cardFeePct}% of price` : undefined },
    { key: "labour", label: "Service labour", cents: labour, basis: p.a.service_basis ?? "unknown" },
  ];
  // Essential: ingredients and packaging. Without them there is no contribution figure, only the gaps.
  const essentialKnown = ingCents != null && pack != null;
  const known = lines.reduce((s, l) => s + (l.cents ?? 0), 0);
  const contributionCents = essentialKnown ? p.priceCents - known : null;
  return {
    priceCents: p.priceCents, lines, contributionCents,
    marginPct: contributionCents == null || p.priceCents <= 0 ? null : Math.round((contributionCents / p.priceCents) * 1000) / 10,
    missing, complete: missing.length === 0,
  };
}

/** A per-serving figure restated per 10 oz pour. Null when the serving size is unknown. */
export function perPour(cents: number | null, servingOz: number | null): number | null {
  if (cents == null || servingOz == null || servingOz <= 0) return null;
  return Math.round((cents * POUR_OZ) / servingOz);
}

// ── the Primal Standard, for a product ────────────────────────────────────────────────────────────────────────────────
export type Outcome = "pass" | "conditional" | "fail" | "unknown" | "not_applicable";
export type StdStatus = "meets" | "conditional" | "does_not_meet" | "not_assessed";
export const STATUS_WORD: Record<StdStatus, string> = { meets: "Meets the standard", conditional: "Conditional", does_not_meet: "Does not meet", not_assessed: "Not assessed" };
export const STATUS_TAG: Record<StdStatus, string> = { meets: "k-tag ok", conditional: "k-tag warn", does_not_meet: "k-tag crit", not_assessed: "k-tag" };

/** THE AGGREGATION RULE, said in full (MEN1):
 *  1. A failed mandatory requirement → Does not meet.
 *  2. No mandatory requirement judged at all → Not assessed.
 *  3. Any mandatory requirement unjudged, unknown, stale, or only proposed (not verified) → Conditional, with each named.
 *  4. Any conditional outcome → Conditional.
 *  5. Only then, every mandatory requirement passed, current and verified → Meets the standard.
 *  Not-applicable (with its approved reason) counts as neither. Optional criteria never lift or lower the status; a
 *  failed optional one is listed. The status is internal Primal qualification — never food-safety approval, never a
 *  health claim. */
export function standardStatus(
  criteria: readonly { id: string; code: string; mandatory: boolean }[],
  current: readonly { criterion_id: string; outcome: Outcome; stale_at: string | null; verification: "proposed" | "independent" | "self" | null }[],
): { status: StdStatus; open: string[]; failed: string[] } {
  const by = new Map(current.map((a) => [a.criterion_id, a]));
  const mand = criteria.filter((c) => c.mandatory);
  const failed: string[] = [], open: string[] = [];
  let judged = 0, conditional = false;
  for (const c of criteria) {
    const a = by.get(c.id);
    if (a?.outcome === "fail") failed.push(c.code);
    if (!c.mandatory) continue;
    if (!a) { open.push(`${c.code}: not judged`); continue; }
    if (a.outcome === "not_applicable") { judged++; continue; }
    judged++;
    if (a.outcome === "unknown") open.push(`${c.code}: unknown`);
    else if (a.stale_at) open.push(`${c.code}: stale — reassess`);
    else if (a.verification === "proposed" || a.verification == null) open.push(`${c.code}: proposed, not verified`);
    if (a.outcome === "conditional") conditional = true;
  }
  if (mand.some((c) => by.get(c.id)?.outcome === "fail")) return { status: "does_not_meet", open, failed };
  if (!mand.length || judged === 0) return { status: "not_assessed", open, failed };
  if (open.length || conditional) return { status: "conditional", open, failed };
  return { status: "meets", open, failed };
}

// ── what a place can do ───────────────────────────────────────────────────────────────────────────────────────────────
export const CAPABILITIES = ["cold_dispense", "nitro_dispense", "cold_storage", "cold_hold_bottles", "hot_hold", "batch_brew", "prep_surface", "ice", "dish_wash", "hand_wash", "dry_storage", "order_point", "pickup_point"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_WORD: Record<Capability, string> = {
  cold_dispense: "Cold dispensing", nitro_dispense: "Nitro dispensing", cold_storage: "Cold storage", cold_hold_bottles: "Cold bottle holding",
  hot_hold: "Hot holding", batch_brew: "Batch brewing", prep_surface: "A prep surface", ice: "Ice", dish_wash: "Ware washing",
  hand_wash: "A hand sink", dry_storage: "Dry storage", order_point: "Somewhere to order", pickup_point: "Somewhere to pick up",
};
/** Which Studio objects provide which capability — explicit, never matched by an object's name or label. A drawn object
 *  says the room is designed for it; it does not say the thing is installed, working or permitted. */
export const PROVIDES: Partial<Record<string, readonly Capability[]>> = {
  tap_tower: ["cold_dispense", "nitro_dispense"], bottle_cooler: ["cold_hold_bottles"], broth_station: ["hot_hold"],
  brew_vessels: ["batch_brew"], prep_counter: ["prep_surface"], reach_in: ["cold_storage"], ice_machine: ["ice"],
  three_sink: ["dish_wash"], hand_sink: ["hand_wash"], storage: ["dry_storage"], order_counter: ["order_point"], walk_up: ["order_point"],
  pickup_shelf: ["pickup_point"],
};
export function capabilitiesOf(kinds: readonly string[]): Map<Capability, number> {
  const m = new Map<Capability, number>();
  for (const k of kinds) for (const c of PROVIDES[k] ?? []) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

export type AssortState = "planned" | "approved" | "ready" | "unavailable" | "retired";
export const ASSORT_WORD: Record<AssortState, string> = { planned: "Planned", approved: "Approved to offer", ready: "Operationally ready", unavailable: "Temporarily unavailable", retired: "Retired" };

/** Can this room serve this product, by design? The gaps, in words. A drawing covers equipment only: suppliers, training,
 *  processes, permits and the product's own qualification are separate gates, named so they're never assumed. */
export function readiness(required: readonly Capability[], kinds: readonly string[], status: StdStatus): { drawn: Capability[]; gaps: string[]; otherGates: string[] } {
  const have = capabilitiesOf(kinds);
  const drawn = required.filter((c) => have.has(c));
  const gaps = required.filter((c) => !have.has(c)).map((c) => `No ${CAPABILITY_WORD[c].toLowerCase()} in the room`);
  const otherGates = [
    status === "meets" ? null : `Primal qualification: ${STATUS_WORD[status].toLowerCase()}`,
    "Ingredients and suppliers confirmed",
    "Crew trained on it",
    "Approved processes in place",
    "Permits and reviews for this place",
  ].filter((x): x is string => !!x);
  return { drawn, gaps, otherGates };
}

// ── scenarios ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MixRow = { productId: string; sharePct: number; priceCents: number; contributionCents: number | null; serviceSeconds: number | null };
/** A day at a location, from a mix: revenue, contribution, and whether the crew can make it. Shares must add to 100
 *  (±0.5); demand that the crew's hours can't make is flagged, never assumed. Service time unknown → capacity unknown. */
export function dayOf(mix: readonly MixRow[], servingsPerDay: number, crewHours: number) {
  const problems: string[] = [];
  const total = mix.reduce((s, r) => s + r.sharePct, 0);
  if (!mix.length) problems.push("No products in the mix.");
  if (Math.abs(total - 100) > 0.5) problems.push(`The mix adds to ${Math.round(total * 10) / 10}%, not 100%.`);
  if (mix.some((r) => r.sharePct < 0)) problems.push("A share below zero.");
  if (!(servingsPerDay >= 0)) problems.push("Servings a day must be zero or more.");
  const n = (r: MixRow) => (servingsPerDay * r.sharePct) / 100;
  const revenue = Math.round(mix.reduce((s, r) => s + n(r) * r.priceCents, 0));
  const unknownContribution = mix.filter((r) => r.contributionCents == null && r.sharePct > 0).length;
  const contribution = unknownContribution ? null : Math.round(mix.reduce((s, r) => s + n(r) * (r.contributionCents ?? 0), 0));
  const unknownTime = mix.filter((r) => r.serviceSeconds == null && r.sharePct > 0).length;
  const busySeconds = unknownTime ? null : mix.reduce((s, r) => s + n(r) * (r.serviceSeconds ?? 0), 0);
  const capacitySeconds = Math.max(0, crewHours) * 3600;
  const overCapacity = busySeconds != null && busySeconds > capacitySeconds;
  if (overCapacity) problems.push(`The crew's ${crewHours} hours can't make ${servingsPerDay} servings at these service times.`);
  return { revenueCents: revenue, contributionCents: contribution, unknownContribution, busyHours: busySeconds == null ? null : Math.round((busySeconds / 3600) * 10) / 10, unknownTime, overCapacity, problems };
}
