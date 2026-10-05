// A PURCHASE THAT IS STOCK (2026-10-05, the form audit, part 3c).
//
// Logging a purchase of ingredients or supplies can put it on the shelf it was bought for, through
// receive_lot (0347): a costed lot — what a pound or a case cost, from whom, on what terms — and the
// restock on the shelf's ledger, in one act. Until now a purchase was only an expense and the shelf
// was counted by hand: what a pound cost reached the batch costing only where someone priced a receipt
// by hand (0298, Atlanta's coffee and water), and everywhere else a batch costed out at $0.00.
//
// This decides which purchases can be stock, which shelves are offered for one and in what order,
// and what a unit cost. Pure, so scripts/smoke.cjs holds it.

/** Spend categories whose purchases go onto a shelf, and the shelf kinds (0295) each one fills. */
export const STOCKED: Readonly<Record<string, readonly string[]>> = {
  ingredients: ["ingredient"],
  supplies: ["consumable", "packaging"],
};

export const isStocked = (category: string | null | undefined): boolean =>
  !!category && Object.prototype.hasOwnProperty.call(STOCKED, category);

export type Shelf = { id: string; name: string; unit: string | null; kind: string | null };
export type LotSeen = { item_name: string; vendor_id: string | null };
export type ShelfChoice = Shelf & { filledBy: boolean; fits: boolean };

/**
 * The city's shelves in the order a purchase is likely to fill them: the ones this supplier has
 * delivered to before, then the kind this category fills, then the rest — each by name. Equipment
 * is not stock (0295) and is never offered.
 */
export function orderShelves(shelves: readonly Shelf[], lots: readonly LotSeen[], vendorId: string | null, category: string | null): ShelfChoice[] {
  const filled = new Set(vendorId ? lots.filter((l) => l.vendor_id === vendorId).map((l) => l.item_name) : []);
  const kinds = new Set(category && isStocked(category) ? STOCKED[category] : []);
  const rank = (s: ShelfChoice) => (s.filledBy ? 0 : s.fits ? 1 : 2);
  return shelves
    .filter((s) => s.kind !== "equipment")
    .map((s) => ({ ...s, filledBy: filled.has(s.name), fits: !!s.kind && kinds.has(s.kind) }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** What one unit cost, in whole cents — the purchase's amount over how much went onto the shelf. */
export function unitCost(cents: number, qty: number): number | null {
  if (!Number.isFinite(cents) || !Number.isFinite(qty) || cents < 0 || qty <= 0) return null;
  return Math.round(cents / qty);
}

/**
 * What the lot is costed at, when whole cents make it differ from what was paid by more than 1%. The
 * unit cost is kept in whole cents (inventory_lots.unit_cost_cents, 0293): 1,000 cups for $45.00 is
 * 4.5¢ a cup, kept as 5¢, and the lot costs out at $50.00. The sheet says so before it is logged.
 */
export function roundedLot(cents: number, qty: number): number | null {
  const per = unitCost(cents, qty);
  if (per === null) return null;
  const total = Math.round(per * qty);
  return Math.abs(total - cents) > Math.max(1, cents * 0.01) ? total : null;
}

/** "a lb", "an oz", "each" — how a price per one of the shelf's units reads. */
export function perUnitWords(unit: string | null | undefined): string {
  const u = (unit ?? "").trim();
  if (!u) return "a unit";
  if (/^(each|ea|ct|pc|pcs|piece|pieces)$/i.test(u)) return "each";
  return /^[aeio]/i.test(u) ? `an ${u}` : `a ${u}`; // "a unit", as it is said
}

/** Units written the same for one or many: weights and volumes, and the ones that mean "each". */
const SAME_PLURAL = /^(each|ea|ct|pc|pcs|dozen|lb|lbs|oz|fl oz|gal|qt|pt|kg|g|l|ml)$/i;

/** "6 cases", "2.5 lb", "1,000" — an amount of the shelf's unit, as a sentence says it. */
export function qtyWords(qty: number, unit: string | null | undefined): string {
  const n = qty.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const u = (unit ?? "").trim();
  if (!u || /^(each|ea|ct|pc|pcs)$/i.test(u)) return n;
  if (qty === 1 || SAME_PLURAL.test(u) || /s$/i.test(u)) return `${n} ${u}`;
  if (/(x|ch|sh)$/i.test(u)) return `${n} ${u}es`;
  if (/[^aeiou]y$/i.test(u)) return `${n} ${u.slice(0, -1)}ies`;
  return `${n} ${u}s`;
}

/** A typed quantity, or null when it is not a positive number. */
export function shelfQty(typed: string): number | null {
  const t = typed.trim().replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}
