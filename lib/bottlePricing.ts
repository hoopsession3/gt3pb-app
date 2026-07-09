// BOTTLE PRICING — the one place pickup packs (lib/orderAhead.ts) and Sunday delivery
// (lib/delivery.ts) get the per-bottle rates that are the SAME across both channels. Previously
// these lived as two entirely separate hardcoded numbers in two unrelated files with nothing
// pointing at the relationship — safe on the actual math (verified byte-identical: fresh/new glass
// is $10 in both, flat bring-back is $8 in both) but a future edit to one could silently drift from
// the other with no signal that they were ever meant to agree.
//
// NOT reconciled here (and shouldn't be silently): pickup's RESERVED-PACK bring-back price gets a
// bulk discount by pack size ($7.50/$7/$6.50 per bottle for 3/6/12) while delivery's bring-back
// stays flat $8/bottle at any size (12/24/36) — delivery instead carries its own flat per-order
// delivery fee (lib/delivery.ts DELIVERY_PRICING.feeCents) that pickup doesn't have. That gap may be
// intentional (delivery's fee already prices in the extra cost, so the bulk discount doesn't also
// need to compound) or may not be — it's a margin/pricing decision, not a cohesion bug, so it's kept
// exactly as-is and named explicitly below rather than quietly unified. Changing any number in this
// file changes what a real customer pays — confirm with the owner first.

export const FRESH_PER_BOTTLE_CENTS = 1000; // $10 — new/fresh glass, every channel, no bulk discount
export const FLAT_BRING_BACK_CENTS = 800;   // $8 — bring-back, walk-up + delivery (no pack-size discount)

// Pickup-only: reserved-pack bring-back gets a bulk discount by pack size (see note above for why
// delivery doesn't mirror this). Dollars, matching lib/orderAhead.ts's PRICING.returnPacks shape.
export const PICKUP_PACK_BRING_BACK_DOLLARS: Record<number, number> = { 3: 22.5, 6: 42.0, 12: 78.0 };
