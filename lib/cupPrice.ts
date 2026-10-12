import { DRINKS, type DrinkId } from "./menu";
import { priceForSlug, type Benefit } from "./benefits";
import { money } from "./money";

// WHAT A CUP COSTS, SAID ONCE (2026-10-12, C2 of the customer frontend audit, approved).
//
// The amount charged could differ from the amount on Pay. The server priced the cart its own way — products first,
// then Square, then the code's own price, with a member's perks (a founding member's $8 latte) — and the screen priced
// it from the menu's prices, read once per app session, with no perks at all. So a price the owner changed while the
// app was open charged more than the button said, and a founding member was charged less than it said: both "the
// amount on the button is not the amount on the card".
//
// Now the server prices the cart before Pay (/api/checkout/quote), the page shows that amount, and the charge carries
// the amount the page showed: a server that would charge anything else refuses before the card, with the new amount
// (priceChangedWords). Pure — the quote, the charge and the tests all run this.

export type CupLine = { slug: DrinkId; name: string; qty: number; baseCents: number; cents: number; perk: string | null };
export type CupPrice = { lines: CupLine[]; subtotal: number };

/** The price the code itself carries — the last fallback, as it always was. */
export const pxCents = (slug: DrinkId): number => Math.round(parseFloat(DRINKS[slug].px.replace("$", "")) * 100);

/** The perk that lowers this cup's price, by its label — the one priceForSlug picks; null when none does. */
export function perkFor(benefits: readonly Benefit[], slug: string, baseCents: number): string | null {
  const best = priceForSlug(benefits as Benefit[], slug, baseCents);
  if (best >= baseCents) return null;
  const hit = benefits.find((b) => priceForSlug([b], slug, baseCents) === best);
  return hit?.label?.trim() || "Member price";
}

/** The cart, priced: products' price first, Square's, then the code's; each cup through the caller's perks. A slug the
 *  menu does not know is named, never priced. Lines keep the cart's order. */
export function priceCups(items: readonly string[], productPrices: Readonly<Record<string, number>>, squarePrices: Readonly<Record<string, number>>, benefits: readonly Benefit[]): CupPrice | { unknown: string } {
  const qty = new Map<DrinkId, number>();
  for (const id of items) {
    if (!DRINKS[id as DrinkId]) return { unknown: id };
    qty.set(id as DrinkId, (qty.get(id as DrinkId) ?? 0) + 1);
  }
  const lines: CupLine[] = [...qty].map(([slug, n]) => {
    const base = productPrices[slug] ?? squarePrices[slug] ?? pxCents(slug);
    return { slug, name: DRINKS[slug].n, qty: n, baseCents: base, cents: priceForSlug(benefits as Benefit[], slug, base), perk: perkFor(benefits, slug, base) };
  });
  return { lines, subtotal: lines.reduce((s, l) => s + l.cents * l.qty, 0) };
}

/** The tip the server takes: whole cents, capped at the subtotal as a fat-finger guard; none on a pay-later send. */
export function tipCentsFor(paying: boolean, tipCents: unknown, subtotal: number): number {
  return paying && typeof tipCents === "number" && Number.isFinite(tipCents) && tipCents > 0 ? Math.min(Math.round(tipCents), subtotal) : 0;
}

/** Refused because the amount moved — said with the amount it is now, which the page shows before the next tap. */
export const priceChangedWords = (amountCents: number, paying: boolean): string =>
  `The price changed — your total is now ${money(amountCents)}. ${paying ? "Tap Pay again to pay it." : "Tap again to send it."}`;
