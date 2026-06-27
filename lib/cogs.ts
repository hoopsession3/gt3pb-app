// COGS math — pure, deterministic. Builds cost of goods from the data that already exists:
//   • per DRINK  = Σ (product_components.qty_per_serving × inventory_items.unit_cost)
//   • per BATCH  = Σ (brew_recipes.ingredients[].qty × matched inventory unit_cost), scaled to the
//                  batch size, then ÷ servable yield → cost per gallon / per 10oz bottle.
// Costs in inventory are in DOLLARS; everything here returns CENTS so margins are exact.
// Anything un-costed (no unit cost, or a recipe ingredient with no matching inventory item) is
// surfaced so the owner knows the number is partial — never silently zeroed.

export interface InvCost { id: string; name: string; unit_cost: number | null; unit: string | null }
export interface Component { product_id: string; inventory_item_id: string; qty_per_serving: number | null; unit: string | null }
export interface ProductRow { id: string; slug: string; name: string; line: string | null; price_cents: number }
export interface BrewIngredient { name: string; qty?: number; unit?: string; scales?: boolean }
export interface BrewRecipeRow { id: string; name: string; style: string | null; base_water_gal: number; ingredients: BrewIngredient[]; yield_factor: number }

const c = (dollars: number) => Math.round(dollars * 100);
export const OZ_PER_GAL = 128;

export interface CogsLine { name: string; qty: number; unit: string | null; costCents: number; costed: boolean }
export interface DrinkCogs { cents: number; lines: CogsLine[]; uncosted: number; hasRecipe: boolean }

// Per-serving ingredient cost for one product, from its bill of materials.
export function drinkCogs(productId: string, components: Component[], invById: Map<string, InvCost>): DrinkCogs {
  const mine = components.filter((x) => x.product_id === productId);
  const lines: CogsLine[] = [];
  let cents = 0, uncosted = 0;
  for (const comp of mine) {
    const inv = invById.get(comp.inventory_item_id);
    const qty = comp.qty_per_serving ?? 0;
    const costed = !!inv && inv.unit_cost != null && comp.qty_per_serving != null;
    const lineCents = costed ? c(qty * (inv!.unit_cost as number)) : 0;
    if (!costed) uncosted++;
    cents += lineCents;
    lines.push({ name: inv?.name ?? "—", qty, unit: comp.unit ?? inv?.unit ?? null, costCents: lineCents, costed });
  }
  return { cents, lines, uncosted, hasRecipe: mine.length > 0 };
}

export interface Margin { profitCents: number; pct: number }
export function margin(priceCents: number, cogsCents: number): Margin {
  const profitCents = priceCents - cogsCents;
  return { profitCents, pct: priceCents > 0 ? Math.round((profitCents / priceCents) * 100) : 0 };
}

export interface BatchCogs {
  batchGal: number; batchCents: number; perGalCents: number; servableGal: number;
  bottles: number; perBottleCents: number; lines: CogsLine[]; uncosted: number;
}
// Cost a brew/broth batch. ingredient qty is defined for base_water_gal; volume-scaling items
// multiply by (batchGal / base_water_gal), fixed items (scales:false) don't. Matched to inventory
// by name (case-insensitive). bottleOz is the pour size for the per-bottle number (default 10).
export function batchCogs(recipe: BrewRecipeRow, invByName: Map<string, InvCost>, batchGal: number, bottleOz = 10): BatchCogs {
  const base = recipe.base_water_gal || 1;
  const factor = base > 0 ? batchGal / base : 1;
  const lines: CogsLine[] = [];
  let cents = 0, uncosted = 0;
  for (const ing of recipe.ingredients ?? []) {
    const scale = ing.scales === false ? 1 : factor;
    const qty = (ing.qty ?? 0) * scale;
    const inv = invByName.get((ing.name ?? "").trim().toLowerCase());
    const costed = !!inv && inv.unit_cost != null && ing.qty != null;
    const lineCents = costed ? c(qty * (inv!.unit_cost as number)) : 0;
    if (!costed) uncosted++;
    cents += lineCents;
    lines.push({ name: ing.name ?? "—", qty: Math.round(qty * 100) / 100, unit: ing.unit ?? inv?.unit ?? null, costCents: lineCents, costed });
  }
  const servableGal = batchGal * (recipe.yield_factor || 1);
  const bottles = Math.floor((servableGal * OZ_PER_GAL) / bottleOz);
  return {
    batchGal, batchCents: cents, perGalCents: batchGal > 0 ? Math.round(cents / batchGal) : 0,
    servableGal: Math.round(servableGal * 100) / 100, bottles,
    perBottleCents: bottles > 0 ? Math.round(cents / bottles) : 0, lines, uncosted,
  };
}
