// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BREW MATH — the one place bottles↔gallons and "start now" live.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DropOps (sizing a drop's batches), BrewPlanner (coverage rows) and the calendar/My Day warn
// chips all consume these, so the numbers can't drift apart. The brew spec's unit: one bottle is
// one 10-oz serving; 128 oz to the gallon; a recipe's yield_factor is the share of the vessel
// that actually becomes pourable product (default 0.92 when a recipe hasn't measured its own).

const GAL_PER_BOTTLE = 10 / 128;
const DEFAULT_YIELD = 0.92;

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

// ═══ SIZING A BATCH BY AN INGREDIENT, NOT BY WATER ═══════════════════════════════════════════════
// The scale sheet only ever asked for gallons of water, which is the wrong end of the problem when
// the thing you actually have a fixed amount of is coffee. You buy coffee by the bag; you do not buy
// water. Asking "how many gallons" and finding out afterwards that it wanted more coffee than is on
// the shelf is the mistake this makes impossible.
//
// Everything here is a pure conversion over the recipe's own ingredient list, so it is unit-tested
// rather than eyeballed in a form.

export type SizingIngredient = { name: string; qty: number | string; unit?: string | null; scales?: boolean };
export type SizingOption = { name: string; unit: string; perGal: number; gramsPerGal: number | null };

// Exact definitions, not approximations: the international pound is 0.45359237 kg by definition, and
// the avoirdupois ounce is a sixteenth of it.
const TO_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
};
const grams = (qty: number, unit: string): number | null => {
  const f = TO_GRAMS[unit.trim().toLowerCase()];
  return f === undefined ? null : qty * f;
};

/** Every ingredient a batch could be sized by: the lines that scale with volume and have a quantity.
 *  A non-scaling line (one filter per brew) can't size anything — doubling it doesn't double a batch. */
export function sizingOptions(ingredients: SizingIngredient[] | null | undefined, baseWaterGal: number): SizingOption[] {
  const base = Number(baseWaterGal) || 0;
  if (!Array.isArray(ingredients) || base <= 0) return [];
  return ingredients
    .filter((i) => i && i.scales !== false && Number(i.qty) > 0 && String(i.name ?? "").trim())
    .map((i) => {
      const unit = String(i.unit ?? "").trim();
      const perGal = Number(i.qty) / base;
      return { name: String(i.name).trim(), unit, perGal, gramsPerGal: grams(perGal, unit) };
    })
    .filter((o) => o.perGal > 0);
}

/** The line to offer FIRST — the one whose supply actually binds a batch.
 *
 *  This started out as "the heaviest measured ingredient", which is wrong and the smoke test caught
 *  it: Rise carries 32 oz of coconut water per 2 gal, which is 454 g/gal against the coffee's 280,
 *  so weight alone picks the coconut water. Coffee is the binding input of a cold-brew company —
 *  it is the expensive line, the one bought by the bag, and the one a crew counts before brewing.
 *  So a coffee line wins outright, and weight only breaks the tie when there isn't one. The caller
 *  can always choose a different line; this only decides what the form opens on. */
export function primarySizing(opts: SizingOption[]): SizingOption | null {
  const weighed = opts.filter((o) => o.gramsPerGal !== null);
  if (!weighed.length) return null;
  const byWeight = weighed.slice().sort((a, b) => (b.gramsPerGal as number) - (a.gramsPerGal as number));
  return byWeight.find((o) => /\bcoffee\b|\bbean/i.test(o.name)) ?? byWeight[0];
}

/** Gallons of water that a given amount of one ingredient makes. */
export const gallonsFromIngredient = (qty: number, perGal: number) =>
  perGal > 0 && Number.isFinite(qty) ? qty / perGal : 0;

/** How much of that ingredient a batch of `gal` gallons calls for. */
export const ingredientForGallons = (gal: number, perGal: number) =>
  Number.isFinite(gal) && Number.isFinite(perGal) ? gal * perGal : 0;

/** Round a batch DOWN to a pourable quarter-gallon. Sizing from a fixed amount of coffee must never
 *  round up: rounding 16.2 gal to 16.25 asks for coffee that is not on the shelf. */
export const quarterGalDown = (g: number) => Math.max(0, Math.floor(g * 4) / 4);
