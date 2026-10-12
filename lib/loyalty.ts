// THE CARD, SAID ONCE (2026-10-12 — C6 of the customer frontend audit and #6 of the account audit, both approved).
//
// Ten stamps, then a cup on us — the eleventh, not the tenth. The card's numbers were worked out in six places, four ways: the account sheet's header
// ("5 to your free pour"), the hub's line ("5 pts · 0 free earned"), Today's card, the crew's scan screen, the member
// card and the Google pass, each with its own `const GOAL = 10`. And "free earned" counted every ten points forever,
// because nothing recorded a free cup as given (0387 does now: a redemption is a ledger row of −10).
//
// profiles.points is the ledger's sum (0229): stamps earned, less ten for every free cup given. So the card is:
//   stamps   points % 10 — the dots on the card now;
//   free     points / 10 — free cups ready to give, not "earned so far";
//   toNext   stamps to the next free cup.
// Pure, and the only place that knows ten.

export const STAMP_GOAL = 10;

export type Card = { points: number; stamps: number; free: number; toNext: number };

/** The card for a points balance. A negative or missing balance is an empty card (0229 notes one can go below zero). */
export function cardOf(points: number | null | undefined): Card {
  const p = Math.max(0, Math.floor(Number(points) || 0));
  const stamps = p % STAMP_GOAL;
  return { points: p, stamps, free: Math.floor(p / STAMP_GOAL), toNext: STAMP_GOAL - stamps };
}

/** "1 free cup ready" · "2 free cups ready" — what is owed, in words. */
export const freeWords = (free: number): string => `${free} free ${free === 1 ? "cup" : "cups"} ready`;

/** The card in one line, the same on every screen: "8/10 · 2 to a free cup", or the free cups ready when there are. */
export function cardLine(c: Card): string {
  return c.free > 0 ? freeWords(c.free) : `${c.stamps}/${STAMP_GOAL} · ${c.toNext} to a free cup`;
}
