// A RESERVE'S STOCK, AND WHAT IS LEFT OF IT (2026-10-04, the form audit).
//
// The reserve card had two number boxes side by side — Stock (stock_total) and Left (stock_remaining)
// — and each saved alone. Raising Stock 12 → 24 wrote stock_total and left stock_remaining at 12, so
// the drop still sold 12: the twelve new bottles existed only on the card. Lowering Stock under Left
// broke 0014's check (stock_remaining ≤ stock_total) and showed Postgres's sentence for it.
//
// What is left is not a second fact. It is the stock less what is already gone — claimed by members
// (claim_reserve takes it off stock_remaining) or held back by hand. So Stock is the box, and Left
// moves with it by the same amount: 24 stock with 5 gone is 19 left. Stock cannot go under what is
// gone; a sold-out drop that gains stock is live again, and a live one with nothing left is sold out,
// as claim_reserve and release_expired_holds already treat it.
//
// Left can still be corrected by hand — a walk-up sale, a few held back for the truck — within 0 and
// the stock, never past it.
//
// Pure: the card writes what this returns, matched on the numbers it read (a member claiming between
// the read and the write makes the write miss, and it is worked out again). scripts/smoke.cjs holds it.

export type ReserveStock = { stock_total: number; stock_remaining: number; status: string };
export type StockPatch = { stock_total: number; stock_remaining: number; status: string };
export type StockChange = { ok: true; patch: StockPatch; gone: number } | { ok: false; reason: string; gone: number };

/** Units no longer available: claimed by members, or held back by hand. */
export const goneOf = (r: ReserveStock): number => Math.max(0, r.stock_total - r.stock_remaining);

/** live ↔ sold_out follows what is left; draft and archived are a person's call and stay. */
function statusFor(current: string, left: number): string {
  if (current === "live" && left === 0) return "sold_out";
  if (current === "sold_out" && left > 0) return "live";
  return current;
}

/** Set the stock. What is left moves by the same amount, so what is gone stays gone. */
export function setStock(r: ReserveStock, total: number): StockChange {
  const gone = goneOf(r);
  if (!Number.isInteger(total) || total < 0) return { ok: false, reason: "Stock is a whole number — zero or more.", gone };
  if (total < gone) return { ok: false, reason: `${gone} already claimed or held — stock can't go below ${gone}.`, gone };
  const left = total - gone;
  return { ok: true, patch: { stock_total: total, stock_remaining: left, status: statusFor(r.status, left) }, gone };
}

/** Correct what is left by hand — anything from none to the whole stock. */
export function setLeft(r: ReserveStock, left: number): StockChange {
  const gone = goneOf(r);
  if (!Number.isInteger(left) || left < 0) return { ok: false, reason: "Left is a whole number — zero or more.", gone };
  if (left > r.stock_total) return { ok: false, reason: `Only ${r.stock_total} in stock — raise Stock first to have ${left} left.`, gone };
  return { ok: true, patch: { stock_total: r.stock_total, stock_remaining: left, status: statusFor(r.status, left) }, gone: r.stock_total - left };
}
