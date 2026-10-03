// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BREW MATH — the one place bottles↔gallons and "start now" live.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DropOps (sizing a drop's batches), BrewPlanner (coverage rows) and the calendar/My Day warn
// chips all consume these, so the numbers can't drift apart. The brew spec's unit: one bottle is
// one 10-oz serving; 128 oz to the gallon; a recipe's yield_factor is the share of the vessel
// that actually becomes pourable product (default 0.92 when a recipe hasn't measured its own).

// ── THE POUR, IN ONE PLACE (2026-10-01) ────────────────────────────────────────────────────────
// "A serving is 10 oz" had THREE homes: this file's GAL_PER_BOTTLE, app/api/agents/brew's own
// SERVE_OZ, and an inline `u * 10 / 128` in lib/eventbrief. That was survivable while it was only
// a display number. It stopped being survivable the moment Ryan set the smallest batch in SERVINGS
// ("start at 3 servings 30 OZ"): the floor of every batch this app will ever plan is now derived
// from the pour, so a 12-oz pour entered in one of the three files would quietly move the minimum
// batch in that file alone. One home, and the other two read it.
export const SERVE_OZ = 10;
export const OZ_PER_GAL = 128;
const GAL_PER_BOTTLE = SERVE_OZ / OZ_PER_GAL;
const DEFAULT_YIELD = 0.92;

// ── THE STEP A BATCH IS ROUNDED TO, AND WHY IT IS NO LONGER A QUARTER GALLON ───────────────────
// Ryan, 2026-10-01: "Recipe should be able to scale down as small as possible to not waste and
// expand as needed." Measured before changing anything — gallonsForBottles rounded UP to 0.25 gal,
// and the waste is not a small-batch problem, it is everywhere:
//
//     want  3 bottles -> brewed 0.50 gal -> made  5     2 wasted   (67% over)
//     want  6 bottles -> brewed 0.75 gal -> made  8     2 wasted
//     want 12 bottles -> brewed 1.25 gal -> made 14     2 wasted
//     want 24 bottles -> brewed 2.25 gal -> made 26     2 wasted
//
// A quarter gallon is 3.2 servings, so rounding demand up to it throws away up to three servings
// of coffee on every single brew. The quarter came from quarterGal, whose own doc says it rounds
// "demand up to the step a crew can actually pour" — a POURING rule that leaked into the brewing
// size and was never a fact about a vessel.
//
// 0.05 gal is 6.4 oz: still a volume somebody can measure into a tower with a jug, and fine enough
// that every count above now lands on zero waste. It is the smallest honest step, not the smallest
// possible one — 0.01 gal would be 1.28 oz of water, which nobody can pour accurately, and a step
// finer than the thing being measured is a false precision.
export const BREW_STEP_GAL = 0.05;

// Both directions live here, together, because they are one rule read two ways and the direction is
// never a free choice: covering demand must round UP or somebody is short, and sizing from a fixed
// amount of coffee must round DOWN or it asks for a bag that is not on the shelf. Writing either one
// inline at a call site is how a third rounding rule gets invented — BrewPlanner had started to.
//
// THE ARITHMETIC IS IN INTEGER HUNDREDTHS OF A GALLON, not in floats. 0.05 has no exact binary
// representation, so the obvious `Math.floor(g / 0.05) * 0.05` returns 16.150000000000002 for a
// 16.1997 gal bag — a number that is not wrong by anything that matters and is still wrong, because
// it goes into brew_batches.batch_gal and onto a screen. Stepping in integers and dividing once at
// the end keeps every result on a clean two decimals. The 1e-9 absorbs the drift in `g * 100`
// itself, so a value already sitting on a step does not jump to the next one.
const STEP_H = Math.round(BREW_STEP_GAL * 100);   // the step, in hundredths of a gallon

/** Round a batch UP to the next brewable step. Demand must always be covered. */
export const stepUpGal = (g: number) =>
  (Math.max(1, Math.ceil(g * 100 / STEP_H - 1e-9)) * STEP_H) / 100;

/** Round a batch DOWN to a brewable step — sizing from a fixed amount must never ask for more. */
export const stepDownGal = (g: number) =>
  (Math.max(0, Math.floor(g * 100 / STEP_H + 1e-9)) * STEP_H) / 100;

/** Vessels fill in quarter-gallon steps — round demand up to the step a crew can actually pour.
 *  NOT the brewing step any more (see BREW_STEP_GAL above); kept because it is the right rounding
 *  for anything that genuinely moves in quarter-gallon units. Nothing in the app calls it today. */
export const quarterGal = (g: number) => Math.max(0.25, Math.ceil(g * 4) / 4);

/** How many bottles a batch of `gal` gallons makes, after the recipe's yield. */
export const bottlesFor = (gal: number, yieldFactor: number | null | undefined) =>
  Math.floor((gal * OZ_PER_GAL * (yieldFactor ?? 1)) / SERVE_OZ);

/** Gallons to brew to cover `bottles`, after yield, rounded up to the next brewable step. */
export const gallonsForBottles = (bottles: number, yieldFactor: number | null | undefined) =>
  stepUpGal((bottles * GAL_PER_BOTTLE) / (Number(yieldFactor) || DEFAULT_YIELD));

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

// ── SAYING A QUANTITY TO SOMEBODY WHO IS COOKING IT (2026-10-01) ───────────────────────────────
// A new operator is joining and will be cooking. BrewSteps rendered `{qty}{unit}` — whatever the
// recipe happened to store — so "560 g" never showed ounces, "32 oz" never showed grams, and
// nothing anywhere said to level the scale.
//
// THIS IS THE ONLY PLACE THAT DECIDES. A second conversion table living in a component is exactly
// the drift this repo keeps finding, so this reuses TO_GRAMS above rather than restating it.
//
// WHAT IT REFUSES TO DO: convert a volume to a weight. "2 gal of water" is about 7.6 kg and "2 gal
// of honey" is about 11.4 kg — the difference is density, which a recipe line does not carry. A
// cook handed a confidently wrong gram figure on a scale is worse off than one handed no figure at
// all, so volumes and counts are passed through untouched and marked as not-weighed.
const TO_OUNCES = 1 / 28.349523125;
const VOLUME_UNITS = new Set([
  "gal", "gallon", "gallons", "qt", "quart", "quarts", "pt", "pint", "pints",
  "l", "liter", "liters", "litre", "litres", "ml", "milliliter", "milliliters",
  "cup", "cups", "tsp", "teaspoon", "teaspoons", "tbsp", "tablespoon", "tablespoons",
  "fl oz", "floz", "fluid ounce", "fluid ounces",
]);

export type MeasureKind = "weighed" | "volume" | "counted";
export type CookQuantity = {
  kind: MeasureKind;
  /** The recipe's own figure, exactly as the recipe card and the cookbook state it. Always set. */
  primary: string;
  /** The same amount in the other system ("19.8 oz"), unbracketed, for a UI that wants to style
   *  the two figures differently. NULL unless it is weighed — a volume has no honest weight
   *  without a density, and nothing here is allowed to invent one. */
  alt: string | null;
  /** primary and alt as ONE string, for everywhere that cannot style two elements: the operator
   *  AI's prompt, a printed prep sheet, a test assertion. One decision, rendered once. */
  display: string;
  grams: number | null;
  ounces: number | null;
  /** Only true when something actually goes on a scale. A "level the scale" prompt on "48 pods"
   *  teaches a cook that the red text is noise — the same way twenty heartbeat alerts taught an
   *  owner to scroll past the word "critical". */
  needsScale: boolean;
};

// Grams get a decimal only when the number is small enough for one to matter; 907.18 g on a kitchen
// scale is 907 g, and the extra digits read as precision the scale does not have.
const showG = (g: number): string => (g < 10 ? `${Math.round(g * 10) / 10} g` : `${Math.round(g)} g`);
const showOz = (o: number): string => (o < 1 ? `${Math.round(o * 100) / 100} oz` : `${Math.round(o * 10) / 10} oz`);

/** How to state one recipe line to somebody who is about to make it. */
export function cookQuantity(qty: number | string | null | undefined, unit?: string | null): CookQuantity {
  const n = Number(qty);
  const u = String(unit ?? "").trim();
  const key = u.toLowerCase();
  const amount = Number.isFinite(n) && n > 0 ? n : null;
  const asWritten = `${qty ?? ""}${u ? ` ${u}` : ""}`.trim();

  // Not weighed, by one of three routes: no usable number, a volume, or a unit this table has
  // never heard of (pods, bags, filters). All three pass the line through untouched.
  const plain = (kind: MeasureKind): CookQuantity =>
    ({ kind, primary: asWritten, alt: null, display: asWritten, grams: null, ounces: null, needsScale: false });

  if (amount === null || !u) return plain("counted");
  if (VOLUME_UNITS.has(key)) return plain("volume");

  const f = TO_GRAMS[key];
  if (f === undefined) return plain("counted");

  const g = amount * f;
  const oz = g * TO_OUNCES;
  // The recipe's own figure leads, so the line still matches the recipe card and the cookbook; the
  // other system follows in brackets. Both are always present on anything that gets weighed.
  const metric = key.startsWith("g") || key.startsWith("k");
  const alt = metric ? showOz(oz) : showG(g);
  return {
    kind: "weighed",
    primary: asWritten, alt, display: `${asWritten} (${alt})`,
    grams: g, ounces: oz, needsScale: true,
  };
}

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
  /** The recipe row's OWN steps (brew_recipes.method) — the column the brew planner writes a batch
   *  sheet from. When present these are THE steps, and the cookbook only adds what the row lacks. */
  rowMethod?: string[] | null;
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

  // THE ANCHOR: the measured pair, stated as a pair, in the recipe's own units — and, from
  // 2026-10-01, in BOTH measurement systems. The new operator is cooking, and the model used to be
  // handed grams only, so answering "how much coffee in ounces?" meant it doing the arithmetic
  // itself. An LLM converting a safety-relevant quantity in its head is a number nobody checked;
  // cookQuantity does it here, exactly, from the same table the batch math uses. Derived figures
  // (a 3 gal batch from a 2 gal anchor) still have to be worked out in the answer — hence the
  // exact factor and the show-your-working rule in MEASURING_RULES.
  const anchor = primary
    ? `ANCHOR (measured, use this): ${cookQuantity(round(primary.perGal * base), primary.unit).display} ${primary.name} : ${round(base, 2)} gal water`
    : `ANCHOR (measured, use this): ${round(base, 2)} gal water`;

  const rates = opts
    .map((o) => `${o.name} ${round(o.perGal, 3)} ${o.unit}/gal`)
    .join(", ");

  const fixed = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .filter((i) => i && i.scales === false && String(i.name ?? "").trim())
    .map((i) => `${String(i.name).trim()} ${cookQuantity(i.qty, i.unit).display}`)
    .join(", ");

  const m = r.method ?? null;
  // ONE PROCEDURE (2026-10-03). The brew planner (app/api/agents/brew) writes a batch sheet from
  // the recipe row's own `method` column — "Cold-extract 12–20 hrs (20 preferred)" — while this
  // line was handing the operator's assistant the cookbook in lib/academy ("~18-hr"), so the two
  // assistants a cook talks to taught two procedures, and every Ask GT3 brew answer ended with
  // "confirm the time with an owner". The row is the recipe's home; its steps are the steps here
  // too. The cookbook still supplies what the row does not keep — serve, storage, the quality
  // gate, troubleshooting — and where its copy names a different time, that is reported as
  // training copy that drifted, for an owner, not as a question for the cook.
  const rowSteps = (Array.isArray(r.rowMethod) ? r.rowMethod : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const cookbookSteps = (m?.brew ?? []).filter(Boolean);
  const steps = rowSteps.length ? rowSteps : cookbookSteps;
  const serve = (m?.serve ?? []).filter(Boolean);
  const trouble = (m?.troubleshoot ?? []).filter((t) => t && t.issue && t.fix);

  const rowHours = Number(r.extraction_hours) || 0;
  // Hours the cookbook's own prose names — batch line, its steps, its fixes.
  const cookbookHours = hoursNamedIn([m?.batch, ...cookbookSteps, ...(trouble.map((t) => t.fix))].join(" "));
  // With no steps of its own, the row's number and the cookbook's prose are two sources of one
  // procedure, and when they disagree nobody here gets to choose. Say so.
  const clash = !rowSteps.length && rowHours > 0 && cookbookHours.length > 0 && !cookbookHours.includes(rowHours);
  // With its own steps, the row IS the procedure. A cookbook that still says something else is
  // copy that drifted from the recipe — an owner's fix, never the cook's doubt.
  const drift = rowSteps.length > 0 && rowHours > 0 && cookbookHours.length > 0 && !cookbookHours.includes(rowHours);

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
      ? `CONFLICT — the recipe record says ${rowHours} h but the written method says ${cookbookHours.join("/")} h. State BOTH, say they disagree, and tell them to confirm with an owner. Do NOT pick one.`
      : "",
    drift
      ? `TRAINING COPY DRIFT — the recipe (the spec) says ${rowHours} h; the training copy in the academy still says ${cookbookHours.join("/")} h. Brew to the recipe. Mention once, in one line, that the academy copy needs an owner's update; do not tell the cook to confirm the time.`
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
// 2026-10-01: 0337 adds brew_vessels.min_gal, the column this comment asked for. The heuristic is
// NOT deleted yet, because the column ships empty — deleting it today would leave every vessel with
// no minimum at all, which is worse than a prompt. Precedence instead: a MEASURED minimum wins and
// is stated as a fact ("under"), the guess applies only while nothing is measured and keeps asking
// rather than asserting ("shallow"). The two verdicts are deliberately different words, because one
// is a measurement and one is a question, and a UI that said the same thing for both would be
// laundering a guess into a specification. When both vessels carry a number, "shallow" is dead.
export type VesselFit =
  | { verdict: "fits"; pct: number }
  | { verdict: "over"; pct: number; overBy: number }
  /** MEASURED: below this vessel's recorded min_gal. A fact. */
  | { verdict: "under"; pct: number; minGal: number }
  /** GUESSED: under a third of capacity and nobody has measured this vessel. A question. */
  | { verdict: "shallow"; pct: number };

export function vesselFit(
  gal: number, capacityGal: number, count = 1, minGal?: number | null,
): VesselFit | null {
  const n = Number(count) || 1;
  const g = Number(gal), cap = Number(capacityGal) * n;
  if (!(g > 0) || !(cap > 0)) return null;
  const pct = Math.round((g / cap) * 100);
  if (g > cap + 0.001) return { verdict: "over", pct, overBy: +(g - cap).toFixed(2) };
  // The recorded minimum is PER VESSEL, so it scales with the count the same way capacity does:
  // two Toddys brewing in parallel are two batches that each have to clear the bag.
  const m = Number(minGal);
  if (Number.isFinite(m) && m > 0) {
    return g < m * n - 0.001 ? { verdict: "under", pct, minGal: +(m * n).toFixed(2) } : { verdict: "fits", pct };
  }
  if (g < cap / 3) return { verdict: "shallow", pct };
  return { verdict: "fits", pct };
}

// ═══ HOW SMALL CAN THIS RECIPE ACTUALLY BE MADE ══════════════════════════════════════════════════
//
// Ryan, 2026-10-01: "Recipe should be able to scale down as small as possible to not waste and
// expand as needed." Asked how small, he said: "Start at 3 servings 30OZ."
//
// THE TRAP IN THAT SENTENCE, AND WHY THIS FUNCTION EXISTS RATHER THAN A CONSTANT: 3 servings is
// 30 oz of FINISHED product, and a batch is measured in water. They are not the same number. At a
// 0.92 yield, 30 oz of water makes 27.6 oz — TWO servings. Set the floor to 30 oz of water and the
// app hands somebody who asked for three a batch that pours two, which is exactly the class of
// quiet lie this codebase keeps finding. The floor is therefore computed THROUGH the recipe's own
// yield, so "3 servings" means three servings came out.
//
// THREE FLOORS, AND THE REAL MINIMUM IS THE LARGEST OF THEM. They are different kinds of fact and
// the UI needs to know which one is binding, because the way out of each is different:
//
//   servings     — policy. Ryan's number. Change it here.
//   vessel       — physical. Below it the gear does not work: half a gallon does not reach the
//                  filter basket of a 5 gal tower. MEASURED, never guessed (see brew_vessels.min_gal).
//                  Null means not measured yet, and a null floor is NOT applied — a floor nobody
//                  measured is not a floor, and inventing one here would be the same mistake as
//                  the capacity/3 heuristic this is replacing.
//   measurement  — the batch stops being weighable. Scale down far enough and a 7 g line becomes
//                  0.4 g, and a kitchen scale reading whole grams cannot tell 0 from 1. The ratio
//                  is what makes the product, so an unweighable ratio is an unmakeable recipe.
//
// THE MEASUREMENT FLOOR, DERIVED NOT GUESSED. A scale with 1 g resolution displaying "7" means the
// true weight is somewhere in [6.5, 7.5) — a reading error of ±(resolution / 2). Expressed as a
// share of the ingredient, that error is (resolution / 2) / weight, and it grows as the batch
// shrinks. Holding it to 5% gives a smallest trustworthy weight of resolution * 10: on Ryan's 1 g
// kitchen scale, 10 g. Below that the line is guesswork wearing a number.
//
// 5% is chosen, not found, and here is the reasoning rather than a bare constant: this app already
// treats a 3% difference in the coffee rate as worth a migration (283.333 vs 291.2 g/gal, 0079 →
// recipeFactLine). A tolerance looser than the differences the business already acts on would be
// incoherent. If a finer scale is ever bought the floor moves with it — pass its resolution.
export const SCALE_RESOLUTION_G = 1;      // Ryan, 2026-10-01: a 1 g kitchen scale.
export const WEIGH_TOLERANCE = 0.05;      // 5% — see above. Not a magic number; a stated one.
export const MIN_SERVINGS = 3;            // Ryan: "Start at 3 servings 30OZ."

/** The smallest weight a scale of this resolution can state within WEIGH_TOLERANCE. */
export const smallestTrustworthyG = (resolutionG: number = SCALE_RESOLUTION_G) =>
  (Math.max(resolutionG, 0.001) / 2) / WEIGH_TOLERANCE;

export type BatchFloorReason = "servings" | "vessel" | "measurement";
export type BatchFloor = {
  /** The smallest batch to offer, in gallons, already rounded UP to a brewable step. */
  gal: number;
  /** Which floor is binding — the one the UI should explain. */
  reason: BatchFloorReason;
  /** What that batch actually pours, after yield. Never fewer than MIN_SERVINGS. */
  servings: number;
  /** Every floor, unrounded, so a caller can say how close the others are. */
  floors: { servings: number; vessel: number | null; measurement: number | null };
  /** On a measurement floor, the line that runs out first and what it weighs there. */
  limiting: { name: string; unit: string; gramsAtFloor: number } | null;
  /** One sentence for a person, naming the binding reason. */
  note: string;
};

/**
 * The smallest batch of this recipe that is worth making, and the reason for the number.
 * Expanding has no equivalent function on purpose: the ceiling is the vessel, which vesselFit
 * already owns, and a recipe has no upper limit of its own.
 */
export function smallestBatch(opts: {
  ingredients: SizingIngredient[] | null | undefined;
  baseWaterGal: number;
  yieldFactor?: number | null;
  /** brew_vessels.min_gal x count. NULL until somebody measures it — see the note above. */
  vesselMinGal?: number | null;
  scaleResolutionG?: number;
  minServings?: number;
}): BatchFloor {
  const y = Number(opts.yieldFactor) || DEFAULT_YIELD;
  const wantServings = Math.max(1, Math.floor(opts.minServings ?? MIN_SERVINGS));

  // FLOOR 1 — servings, through the yield. This is the "30 oz of finished, not of water" line.
  const servingsFloor = (wantServings * GAL_PER_BOTTLE) / y;

  // FLOOR 2 — the vessel, only if somebody measured it.
  const vm = Number(opts.vesselMinGal);
  const vesselFloor = Number.isFinite(vm) && vm > 0 ? vm : null;

  // FLOOR 3 — measurement. Every WEIGHED line has a grams-per-gallon rate; the line with the
  // SMALLEST rate is the one that becomes unreadable first, so it sets the floor for all of them.
  // Volumes and counts are skipped: nothing puts them on a scale (see cookQuantity).
  const minG = smallestTrustworthyG(opts.scaleResolutionG ?? SCALE_RESOLUTION_G);
  const weighed = sizingOptions(opts.ingredients, opts.baseWaterGal)
    .filter((o) => o.gramsPerGal !== null && (o.gramsPerGal as number) > 0);
  let measurementFloor: number | null = null;
  let limiting: BatchFloor["limiting"] = null;
  if (weighed.length) {
    const tightest = weighed.reduce((a, b) =>
      (a.gramsPerGal as number) <= (b.gramsPerGal as number) ? a : b);
    measurementFloor = minG / (tightest.gramsPerGal as number);
    limiting = { name: tightest.name, unit: tightest.unit, gramsAtFloor: minG };
  }

  // The real minimum is the largest of the three — a floor is a floor.
  const candidates: { gal: number; reason: BatchFloorReason }[] = [
    { gal: servingsFloor, reason: "servings" },
    ...(vesselFloor !== null ? [{ gal: vesselFloor, reason: "vessel" as const }] : []),
    ...(measurementFloor !== null ? [{ gal: measurementFloor, reason: "measurement" as const }] : []),
  ];
  const binding = candidates.reduce((a, b) => (b.gal > a.gal ? b : a));
  const gal = stepUpGal(binding.gal);
  const servings = bottlesFor(gal, y);

  // The servings sentence has to stay true at a 100% yield, where the gap between the water and
  // the finished product is the brewable STEP and not the yield. Blaming the yield there would read
  // as "more than 30 oz because only 100% comes out pourable", which is nonsense dressed as a
  // reason — and a reason nobody can follow is how a number stops being questioned.
  const wantOz = wantServings * SERVE_OZ;
  const note =
    binding.reason === "servings"
      ? `${wantServings} servings is the smallest batch worth making. That is ${gal.toFixed(2)} gal of water — `
        + (y < 1
          ? `more than ${wantOz} oz, because only ${Math.round(y * 100)}% of what goes in comes out pourable.`
          : `the next ${BREW_STEP_GAL} gal step above ${wantOz} oz.`)
      // "RECORDED FOR IT", not "the gear does not work" (2026-10-01). The first wording asserted a
      // physical mechanism, and the moment real numbers arrived that stopped being safe: Ryan
      // measured the Cold Brew Avenue at 1.0 gal, but for the Toddy he found no stated minimum and
      // chose 0.5 as a working floor. The old sentence would have told a cook the gear fails below
      // half a gallon, which nobody has established. This says what is true of both — there is a
      // number on file for this vessel — and brew_vessels.notes carries which kind it is.
      : binding.reason === "vessel"
        ? `The vessel sets this, not the recipe: ${vesselFloor?.toFixed(2)} gal is the smallest batch recorded for it. That batch pours ${servings} servings.`
        : `The scale sets this. Smaller than ${gal.toFixed(2)} gal and ${limiting?.name} falls under ${minG} g, which a ${opts.scaleResolutionG ?? SCALE_RESOLUTION_G} g scale cannot read closely enough to hold the ratio. That batch pours ${servings} servings.`;

  return {
    gal, reason: binding.reason, servings,
    floors: { servings: servingsFloor, vessel: vesselFloor, measurement: measurementFloor },
    limiting: binding.reason === "measurement" ? limiting : null,
    note,
  };
}
