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

// ═══ THE RECIPE AS A SENTENCE THE ASSISTANT CAN ONLY READ, NOT RE-DERIVE ═════════════════════════
//
// Ask GT3 was asked "Rise 340 grams" on two days and gave two different water volumes — 1.21 gal
// once, 1.17 gal the next — and on the second day the bold lead line (7.9 lb / 3.6 L) disagreed
// with the arithmetic printed three lines beneath it (4.4 L) by 19%.
//
// The cause was not the model. THREE DIFFERENT RATES for one spec were reachable in this app:
//
//     280.0 g/gal   the stored recipe row, 560 g per 2 gal — what the scale sheet uses
//     283.3 g/gal   the determined anchor, 340 g per 1.2 gal at 2.5% TDS — what is TRUE
//     291.2 g/gal   "1:13" taken literally, 3785.41 g of water ÷ 13
//
// Six fluid ounces apart on a single 340 g batch, and the assistant was handed `ratio` and an
// ingredient list and left to pick. "1:13" is the NAME of this spec; "340 g to 1.2 gallons" is the
// MEASUREMENT that actually lands on 2.5 TDS. They differ because the name is rounded — 1.2 gal of
// water to 340 g of coffee is 1:13.36 — and a name is not a number to compute from.
//
// So the grounding sentence is BUILT HERE, by the same functions the scale sheet renders from. The
// agent is given finished per-gallon rates and an explicit anchor pair; there is no arithmetic left
// for it to do differently, and no second place for the rate to live.

export type RecipeFacts = {
  name: string; style?: string | null; ratio?: string | null;
  base_water_gal: number | string | null;
  ingredients: SizingIngredient[] | null | undefined;
  extraction_hours?: number | null; target_spec?: string | null;
  /** The written method, joined in from the cookbook. Quantities are data; HOW is procedure. */
  method?: RecipeMethod | null;
  /** The gear this brew needs, by name. A recipe without its kit is a recipe you cannot run. */
  gear?: string[] | null;
};

export type RecipeMethod = {
  batch?: string; brew?: string[]; serve?: string[];
  storage?: string; quality?: string;
  troubleshoot?: { issue: string; fix: string }[];
};

/**
 * Hours named inside written prose — "cold-extract ~18 hrs".
 *
 * Exists to CATCH A CONTRADICTION, not to extract a value. brew_recipes.extraction_hours says 20
 * for the OG recipes; the cookbook's own steps say ~18, three times. Both are handed to the agent
 * in the same system prompt, so it can answer either and has. The fact that two sources disagree is
 * itself a fact the crew needs, and picking one silently is how a wrong brew time gets authoritative.
 */
export function hoursNamedIn(text: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const m of String(text ?? "").matchAll(/(\d{1,2}(?:\.\d)?)\s*-?\s*(?:hr|hrs|hour|hours|h)\b/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

const round = (n: number, dp = 1) => {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
};

/**
 * One recipe → the exact sentence an agent is grounded on.
 *
 * Every quantity comes from the ingredient list via sizingOptions, which is what BrewPlanner and
 * DropOps already size batches with. `ratio` is passed through as a LABEL and explicitly fenced off
 * from calculation, because computing from it is precisely how the answers drifted.
 */
export function recipeFactLine(r: RecipeFacts): string {
  const base = Number(r.base_water_gal) || 0;
  const opts = sizingOptions(r.ingredients, base);
  const primary = primarySizing(opts);

  const head = `- ${r.name}${r.style ? ` [${r.style}]` : ""}`;
  if (base <= 0 || opts.length === 0) {
    // Say so rather than emit a half-fact the model will fill in for itself.
    return `${head}: no measured base on file — say it is not on file and to check with an owner. Do NOT compute one.`;
  }

  // THE ANCHOR: the measured pair, stated as a pair, in the recipe's own units.
  const anchor = primary
    ? `ANCHOR (measured, use this): ${round(primary.perGal * base)} ${primary.unit} ${primary.name} : ${round(base, 2)} gal water`
    : `ANCHOR (measured, use this): ${round(base, 2)} gal water`;

  const rates = opts
    .map((o) => `${o.name} ${round(o.perGal, 3)} ${o.unit}/gal`)
    .join(", ");

  const fixed = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .filter((i) => i && i.scales === false && String(i.name ?? "").trim())
    .map((i) => `${String(i.name).trim()} ${i.qty}${i.unit || ""}`)
    .join(", ");

  const m = r.method ?? null;
  const steps = (m?.brew ?? []).filter(Boolean);
  const serve = (m?.serve ?? []).filter(Boolean);
  const trouble = (m?.troubleshoot ?? []).filter((t) => t && t.issue && t.fix);

  // Two sources name an extraction time and they do not agree. Say so rather than choose.
  const proseHours = hoursNamedIn([m?.batch, ...steps, ...(trouble.map((t) => t.fix))].join(" "));
  const rowHours = Number(r.extraction_hours) || 0;
  const clash = rowHours > 0 && proseHours.length > 0 && !proseHours.includes(rowHours);

  return [
    `${head}: ${anchor}.`,
    `Scale LINEARLY from the anchor — per gallon: ${rates}.`,
    fixed ? `DOES NOT SCALE (one per brew regardless of size): ${fixed}.` : "",
    r.target_spec ? `Target: ${r.target_spec}.` : "",
    rowHours ? `Extraction: ${rowHours} h cold.` : "",
    r.ratio ? `"${r.ratio}" is this recipe's NAME, not a number to calculate from — the anchor above is the measurement.` : "",
    // THE METHOD. Quantities alone answer "how much"; a crew mid-shift is asking "how". Every step
    // ships with the recipe so a brew question is answered end to end and nothing is left out.
    steps.length ? `METHOD (give EVERY step, in order — none of them are optional): ${steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}` : "",
    serve.length ? `SERVE: ${serve.join(" → ")}.` : "",
    m?.storage ? `STORAGE: ${m.storage}` : "",
    m?.quality ? `QUALITY GATE: ${m.quality}` : "",
    trouble.length ? `IF IT COMES OUT WRONG: ${trouble.map((t) => `${t.issue} → ${t.fix}`).join(" ")}` : "",
    r.gear?.length ? `GEAR THIS BREW NEEDS: ${r.gear.join("; ")}.` : "",
    clash
      ? `CONFLICT — the recipe record says ${rowHours} h but the written method says ${proseHours.join("/")} h. State BOTH, say they disagree, and tell them to confirm with an owner. Do NOT pick one.`
      : "",
  ].filter(Boolean).join(" ");
}

// ── DOES THIS BATCH FIT THE THING YOU ARE BREWING IT IN ───────────────────────────────────────────
//
// Ryan sized a batch from half a 340 g bag on 2026-09-07: 170 g at 1:13 is 0.607 gal, which rounds
// down to 0.5. Correct arithmetic, and not brewable — the only vessel on file is a 5 gal tower with
// a filter basket, and half a gallon does not reach the basket. The planner offered the vessel and
// the size side by side and never mentioned that one did not fit the other.
//
// TOO BIG is a fact: past capacity the water has nowhere to go.
//
// TOO SMALL is NOT a fact and this does not pretend it is. The real minimum depends on where the
// basket sits, which is not recorded anywhere and which I have not measured. A third of capacity is
// a prompt to go and look at the vessel, not a specification of it — so the copy asks rather than
// asserts, and it never blocks. If the true minimum is ever measured it belongs on brew_vessels as
// a column, and this heuristic should be deleted the day it is.
export type VesselFit =
  | { verdict: "fits"; pct: number }
  | { verdict: "over"; pct: number; overBy: number }
  | { verdict: "shallow"; pct: number };

export function vesselFit(gal: number, capacityGal: number, count = 1): VesselFit | null {
  const g = Number(gal), cap = Number(capacityGal) * (Number(count) || 1);
  if (!(g > 0) || !(cap > 0)) return null;
  const pct = Math.round((g / cap) * 100);
  if (g > cap + 0.001) return { verdict: "over", pct, overBy: +(g - cap).toFixed(2) };
  if (g < cap / 3) return { verdict: "shallow", pct };
  return { verdict: "fits", pct };
}
