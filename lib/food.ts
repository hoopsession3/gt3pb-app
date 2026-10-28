// PRIMAL FOOD (PF1, 0459) — a planned expansion, not a menu item: the words the food screens share with the database, and
// a recipe's cost worked by hand. Nothing here is a price, a quote or a temperature rule: those are entered with their
// source. Every figure a screen shows from this is a conditional projection until an owner approves the item and its plan.

export const ALLERGENS = ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];
/** The nine major food allergens, as a label says them. */
export const ALLERGEN_WORD: Record<Allergen, string> = { milk: "Milk", eggs: "Eggs", fish: "Fish", shellfish: "Crustacean shellfish", tree_nuts: "Tree nuts", peanuts: "Peanuts", wheat: "Wheat", soy: "Soy", sesame: "Sesame" };

export type FoodStatus = "concept" | "proposed" | "approved" | "live" | "retired";
export const FOOD_STATUS_WORD: Record<FoodStatus, string> = { concept: "Concept", proposed: "Proposed", approved: "Approved — not on the menu", live: "On the menu", retired: "Retired" };
export const FOOD_STATUS_TAG: Record<FoodStatus, string> = { concept: "k-tag", proposed: "k-tag gold", approved: "k-tag ok", live: "k-tag ok", retired: "k-tag" };
export const FOOD_CATEGORIES = ["bowl", "plate", "handheld", "snack", "side", "other"] as const;

export type FoodItem = { id: string; name: string; category: (typeof FOOD_CATEGORIES)[number]; status: FoodStatus; summary: string | null; serving: string | null; allergens: Allergen[]; packaging: string | null; target_price_cents: number | null; price_source: string | null; plan_id: string | null; product_id: string | null; approved_by: string | null; approved_at: string | null; created_at: string };
export type Component = { name: string; raw_g: number; cost_cents_per_kg?: number | null; cost_source?: string | null; allergens?: Allergen[] };
export type FoodRecipe = { id: string; food_item_id: string; version: number; status: "draft" | "approved" | "retired"; portion_g: number; cook_loss_pct: number; components: Component[]; method: string | null; cook_rule: string | null; hold_rule: string | null; rule_source: string | null; shelf_life_hours: number | null; discard_rule: string | null; approved_at: string | null; created_at: string };

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** One portion's ingredients, worked out. The components are per portion, raw. A cost missing from any component makes
 *  the cost unknown — never a smaller number — and names what's missing. */
export type PortionCost = { rawG: number; cookedG: number; portionG: number; yieldGap: number | null; ingredientCents: number | null; missing: string[]; allergens: Allergen[] };
export function portionCost(r: Pick<FoodRecipe, "portion_g" | "cook_loss_pct" | "components">): PortionCost {
  const comps = (r.components ?? []).filter((c) => c && Number(c.raw_g) > 0);
  const rawG = comps.reduce((n, c) => n + Number(c.raw_g), 0);
  const cookedG = r1(rawG * (1 - Number(r.cook_loss_pct || 0) / 100));
  const missing = comps.filter((c) => c.cost_cents_per_kg == null || !(Number(c.cost_cents_per_kg) >= 0) || !String(c.cost_source ?? "").trim()).map((c) => c.name);
  const ingredientCents = !comps.length || missing.length ? null : r0(comps.reduce((n, c) => n + (Number(c.raw_g) / 1000) * Number(c.cost_cents_per_kg), 0));
  const portionG = Number(r.portion_g);
  // The components cooked should come to the portion. More than a tenth off and the recipe and the portion disagree.
  const yieldGap = portionG > 0 && rawG > 0 ? r1(((cookedG - portionG) / portionG) * 100) : null;
  const allergens = ALLERGENS.filter((a) => comps.some((c) => (c.allergens ?? []).includes(a)));
  return { rawG: r1(rawG), cookedG, portionG, yieldGap, ingredientCents, missing, allergens };
}

/** What the price leaves after the ingredients — ingredients only: packaging, labor, fees and waste are not in it yet,
 *  and the screen says so. Null when either side isn't known. */
export function ingredientMargin(priceCents: number | null, ingredientCents: number | null): { leftCents: number; pct: number } | null {
  if (priceCents == null || ingredientCents == null || priceCents <= 0) return null;
  return { leftCents: priceCents - ingredientCents, pct: r1(((priceCents - ingredientCents) / priceCents) * 100) };
}

/** The allergens a recipe's components carry that the item doesn't declare — a label that would be wrong. */
export const undeclared = (item: Pick<FoodItem, "allergens">, cost: PortionCost) => cost.allergens.filter((a) => !item.allergens.includes(a));
