// HOW MANY BOTTLES ARE ON THE SHELF (2026-10-04, the form audit).
//
// The pack-out plan opened with "10oz bottles on hand: 122". That was not a count. It was a frozen
// copy of 0044's seed row — '10 oz Clear Glass Stout Decanter Bottle…', qty 122 — typed into the
// component as a default, and it drove the plan's "Short on bottles" warning. The shelf could hold
// anything; the plan said 122 every time, in every city, at either size.
//
// The shelf knows. inventory_status carries each item's effective on-hand (the ledger's balance, else
// the hand count) per market, so the plan reads the bottle shelves of the event's own city:
//
//   · every matching shelf counts single bottles (unit "each") → their total IS bottles on hand
//   · any of them counts in cases, packs or boxes → the shelf is shown as it is ("122 case"), and the
//     number is left to a person: how many bottles a case holds is not written down anywhere, and a
//     guess at it would be the frozen 122 again by another route
//   · none matches → said, and the box starts empty
//
// A bottle shelf is one whose name says "bottle" and the size ("10 oz", "10oz", "10-oz"). Pure, so
// scripts/smoke.cjs holds it to every case above.

export type ShelfRow = { name: string; unit: string | null; effective_on_hand: number | null; market: string | null };

export type BottleStock =
  | { kind: "count"; bottles: number; shelves: string[] }
  | { kind: "other"; shelves: { name: string; qty: number | null; unit: string | null }[] }
  | { kind: "none" };

/** Does this shelf's name say it is a bottle of this size? */
export function isBottleShelf(name: string, oz: number): boolean {
  const n = name.toLowerCase();
  return /\bbottles?\b/.test(n) && new RegExp(`(^|[^0-9.])${oz}\\s*-?\\s*oz\\b`).test(n);
}

const COUNTS_SINGLES = new Set(["each", "ea", "bottle", "bottles"]);

/** What the shelves of `market` say about bottles of `oz` ounces. */
export function bottleStock(shelves: readonly ShelfRow[], oz: number, market: string): BottleStock {
  const mine = shelves.filter((s) => (s.market ?? "") === market && isBottleShelf(s.name ?? "", oz));
  if (mine.length === 0) return { kind: "none" };
  const singles = mine.every((s) => COUNTS_SINGLES.has((s.unit ?? "").trim().toLowerCase()) && typeof s.effective_on_hand === "number");
  if (singles) {
    return { kind: "count", bottles: Math.max(0, Math.floor(mine.reduce((t, s) => t + (s.effective_on_hand as number), 0))), shelves: mine.map((s) => s.name) };
  }
  return { kind: "other", shelves: mine.map((s) => ({ name: s.name, qty: s.effective_on_hand, unit: s.unit })) };
}
