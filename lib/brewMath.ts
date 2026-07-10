// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BREW MATH — the one place bottles↔gallons and "start now" live.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DropOps (sizing a drop's batches), BrewPlanner (coverage rows) and the calendar/My Day warn
// chips all consume these, so the numbers can't drift apart. The brew spec's unit: one bottle is
// one 10-oz serving; 128 oz to the gallon; a recipe's yield_factor is the share of the vessel
// that actually becomes pourable product (default 0.92 when a recipe hasn't measured its own).

export const GAL_PER_BOTTLE = 10 / 128;
export const DEFAULT_YIELD = 0.92;

/** Vessels fill in quarter-gallon steps — round demand up to the step a crew can actually pour. */
export const quarterGal = (g: number) => Math.max(0.25, Math.ceil(g * 4) / 4);

/** How many bottles a batch of `gal` gallons makes, after the recipe's yield. */
export const bottlesFor = (gal: number, yieldFactor: number | null | undefined) =>
  Math.floor((gal * 128 * (yieldFactor ?? 1)) / 10);

/** Gallons to brew to cover `bottles`, after yield, rounded to the pourable quarter-gal. */
export const gallonsForBottles = (bottles: number, yieldFactor: number | null | undefined) =>
  quarterGal((bottles * GAL_PER_BOTTLE) / (Number(yieldFactor) || DEFAULT_YIELD));

/** The "start now" rule: a still-planned batch past its latest start won't be ready in time.
 *  (A batch already brewing is committed — no warn.) */
export const brewStartOverdue = (
  b: { status?: string | null; latest_start_at?: string | null },
  now: number = Date.now(),
) => b.status === "planned" && !!b.latest_start_at && new Date(b.latest_start_at).getTime() < now;

/** Per-flavor bottle demand across a drop's orders (each order's mix: {RISE: n, …}). */
export function flavorDemand<F extends string>(
  rows: { mix: Partial<Record<F, number>> | null }[],
  flavors: readonly F[],
): Record<F, number> {
  const out = Object.fromEntries(flavors.map((f) => [f, 0])) as Record<F, number>;
  rows.forEach((r) => flavors.forEach((f) => { out[f] += r.mix?.[f] || 0; }));
  return out;
}
