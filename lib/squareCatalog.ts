import { DRINKS, type DrinkId } from "./menu";
import { SQUARE_BASE, SQUARE_VERSION } from "./squareServer";

// Moved here from app/api/checkout (2026-10-12, C2): the cup checkout and its quote (/api/checkout/quote) price the
// same cart, so the one fallback they share lives in one place.
//
// Square Catalog as a secondary sync — used ONLY for items missing from `products` (a catalog gap),
// never as the primary source. products.price_cents is the one price authority (0062, and the same
// order MenuManager writes to + /api/menu already serves to the client) — Square used to be checked
// first here, which meant a reprice via Money > Menu could silently charge the OLD Square/hardcoded
// price. lib/menu.ts's px stays as the final fallback (revenue continuity beats a hard fail if both
// products and Square are unreachable) but is never preferred over a real price.
//
// Square has no concept of our slugs, so its items are matched back to one by DISPLAY NAME. For 7 of
// 10 items the lowercased name happens to equal the slug (rise, flow, dusk, tide, forge, hunt, wild),
// which used to mask this bug: kingme ("KING ME"), maple ("SALTED MAPLE LATTE"), and aide ("NATURE'S
// AIDE") don't match their slug — so a name-keyed map silently missed the live Square price for those
// 3 below (lib/cupPrice looks this map up BY SLUG) and fell through to the stale lib/menu.ts price instead,
// whenever this fallback actually fired.
const NAME_TO_SLUG: Record<string, DrinkId> = Object.fromEntries(
  (Object.keys(DRINKS) as DrinkId[]).map((slug) => [DRINKS[slug].n.toLowerCase(), slug])
) as Record<string, DrinkId>;

export async function squarePriceMap(token: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const m: Record<string, number> = {};
    for (const o of data?.objects ?? []) {
      const n = o?.item_data?.name?.toLowerCase();
      const a = o?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      const slug = n ? NAME_TO_SLUG[n] : undefined;
      if (slug && typeof a === "number") m[slug] = a;
    }
    return m;
  } catch {
    return {};
  }
}
