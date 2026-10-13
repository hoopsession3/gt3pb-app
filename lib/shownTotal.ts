import { money } from "./money";

// THE TOTAL THE PAGE SHOWED IS THE MOST A CHECKOUT CHARGES (2026-10-13, R5 of the customer audit).
//
// The pack and delivery checkouts re-price on the server — rightly: the page is never trusted with the amount. But the
// page never said what it had shown, so a server total above it was charged without a word: a member saw $106 on the
// 12-bottle delivery tile and paid $130 (the page's refills started at 0 — fixed in components/OrderFunnel too), and
// a price changed while the page was open would have done the same.
//
// The page now sends the total on its Pay button. A server total ABOVE it is refused before any charge, with the total
// it would charge, so the customer sees the number before paying it; the page shows it on the button and the next tap
// agrees to it. A total below what was shown goes through — the customer pays less (a member's perk the page cannot
// see is the usual reason) and the confirmation says what was charged. A page that sends no total (an older iPhone
// build) is not checked, as before.

/** The total a page says it showed, in cents — or null when it sent none (or nothing that is an amount). */
export function shownCents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

export type TotalChanged = { error: string; totalChanged: true; totalCents: number };

/** The refusal when the charge would be more than the page showed; null when it is not. */
export function aboveShown(chargeCents: number, shown: number | null): TotalChanged | null {
  if (shown === null || chargeCents <= shown) return null;
  return {
    error: `The total is ${money(chargeCents)}, not the ${money(shown)} shown. Check your order, then tap again to pay ${money(chargeCents)}.`,
    totalChanged: true,
    totalCents: chargeCents,
  };
}
