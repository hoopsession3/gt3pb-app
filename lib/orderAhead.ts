// ORDER-AHEAD — single source of truth for the Saturday-drop reserve model. Pure + deterministic
// (no DOM, no env) so it runs identically on the server (authoritative price + cutoff), in the client
// UI, and under the smoke suite. Ported from the approved reference build (gt3pb-orderahead-app-v1.0).
//
// MODEL: one-off pre-orders only — no subscription, no deposit, no recurring billing. Order by
// Wed 18:00 local, pick up the following Saturday. Bring bottles back for pack pricing, or new glass
// at a flat $10. The 70% margin floor lives in this grid: no promo codes, no rounding, no extra
// discounts anywhere.

import { FRESH_PER_BOTTLE_CENTS, FLAT_BRING_BACK_CENTS, PICKUP_PACK_BRING_BACK_DOLLARS } from "./bottlePricing";
import { etDayKey } from "./dates";

export const PRICING = {
  // order-ahead + bring bottles back — pickup's own bulk-discount schedule (see lib/bottlePricing.ts)
  returnPacks: PICKUP_PACK_BRING_BACK_DOLLARS as Record<number, number>,
  // order-ahead, new glass — flat per bottle, NO pack discount. Same rate as every other channel.
  newPerBottle: FRESH_PER_BOTTLE_CENTS / 100,
  // walk-up reference copy (in-person at the truck) — same flat rates as delivery's fresh/refill.
  walkup: { newGlass: FRESH_PER_BOTTLE_CENTS / 100, bringBack: FLAT_BRING_BACK_CENTS / 100, single: FRESH_PER_BOTTLE_CENTS / 100 },
  // [FLAG] false → single-flavor packs only (steppers collapse to one choice). Default true.
  allowFlavorMix: true,
} as const;

export const PACK_SIZES = [3, 6, 12] as const;
export type PackSize = (typeof PACK_SIZES)[number];
export const PACK_TAG: Record<number, string> = { 6: "MOST POPULAR", 12: "BEST VALUE" };

export type GlassPath = "return" | "new";

export const FLAVORS = ["RISE", "FLOW", "DUSK"] as const;
export type Flavor = (typeof FLAVORS)[number];
export const FLAVOR_DESC: Record<Flavor, string> = {
  RISE: "Organic coconut",
  FLOW: "Organic cacao nibs",
  DUSK: "Ceylon cinnamon · cardamom",
};
export type Mix = Record<Flavor, number>;
export const emptyMix = (): Mix => ({ RISE: 0, FLOW: 0, DUSK: 0 });

// "≈ how much" hint under the pack tiles
export const PACK_HINT: Record<number, string> = {
  3: "a few across the week",
  6: "one a day till the next drop",
  12: "two a day, or enough for two",
};

// ── pure money math (authoritative — the server recomputes with these, never trusting the client) ──
export const isPackSize = (n: number): n is PackSize => (PACK_SIZES as readonly number[]).includes(n);
export const newGlassTotal = (size: number): number => size * PRICING.newPerBottle;
export const packTotal = (size: number, glass: GlassPath): number =>
  glass === "return" ? (PRICING.returnPacks[size] ?? newGlassTotal(size)) : newGlassTotal(size);
// what a return pack saves vs paying $10/bottle for new glass (only shown on the return path).
// Rounds to the nearest CENT, not the nearest whole dollar — a bare Math.round() on the dollar
// figure was bumping the 3-pack's true $7.50 savings up to a displayed "$8", right next to the
// correct $7.50/bottle and $22.50 total on the same screen (6- and 12-packs land on whole dollars
// already, which is why this only ever showed up on the 3-pack). The actual charge (packTotal) was
// never affected — this was marketing copy overstating itself, not a pricing bug.
export const saveAmount = (size: number): number => Math.round((newGlassTotal(size) - (PRICING.returnPacks[size] ?? newGlassTotal(size))) * 100) / 100;
export const perBottle = (size: number, glass: GlassPath): number => packTotal(size, glass) / size;
export const toCents = (dollars: number): number => Math.round(dollars * 100);
// This module computes pack pricing in DOLLARS and converts at the boundary (toCents above),
// which is deliberate and has its own rounding history — see saveAmount. So it keeps a dollars-in
// formatter, but the implementation is lib/money's, named for its unit so nobody has to guess which
// `dollars` a file has in scope. OrderFunnel used to shadow this one with a cents-in function of
// the same name; only the shadowing kept the two units apart.
export { moneyFromDollars as dollars } from "./money";

// ── flavor mix ──
export const mixTotal = (mix: Mix): number => FLAVORS.reduce((a, f) => a + (mix[f] || 0), 0);
export const mixComplete = (mix: Mix, size: number): boolean => mixTotal(mix) === size;
// when the pack shrinks below the current mix, the overfull mix resets (reference behavior)
export const mixFitsOrReset = (mix: Mix, size: number): Mix => (mixTotal(mix) > size ? emptyMix() : mix);
export const mixSummary = (mix: Mix): string => FLAVORS.filter((f) => mix[f] > 0).map((f) => `${mix[f]}× ${f}`).join(" · ");

// ── cutoff / drop resolver ──
// Saturday drop; ordering closes Wed 18:00 local (Saturday − 3 days). Past cutoff rolls to next week.
// `now` is injectable so the server can pass its own clock and the smoke suite can pin a moment.
export function nextDrop(now: Date = new Date()): { sat: Date; cutoff: Date } {
  // Anchored at NOON local so dropDateKey (ET day) lands on the same calendar day whether this
  // runs on a UTC server or a US client — local midnight reads as the ET day before on Vercel.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const daysToSat = (6 - d.getDay() + 7) % 7;
  const sat = new Date(d); sat.setDate(d.getDate() + daysToSat);
  const cutoff = new Date(sat); cutoff.setDate(sat.getDate() - 3); cutoff.setHours(18, 0, 0, 0);
  if (now.getTime() > cutoff.getTime()) { sat.setDate(sat.getDate() + 7); cutoff.setDate(cutoff.getDate() + 7); }
  return { sat, cutoff };
}
// is a given drop date (server-trusted) still open at `now`? Guards the reserve API against a
// client that posts a stale/closed drop.
export function dropIsOpen(dropDateISO: string, now: Date = new Date()): boolean {
  const { sat } = nextDrop(now);
  return dropDateISO.slice(0, 10) === dropDateKey(sat);
}

// A pack pickup always follows the truck's NEXT scheduled stop: pickup = that stop's date, and
// ordering closes **24 hours before** it — the packs are brewed to order, so a full day's lead is
// what lets the crew brew and bottle for the drop. Used when a stop is scheduled; the Saturday
// nextDrop() above is the fallback when the route is empty.
export const STOP_LEAD_MS = 24 * 60 * 60 * 1000; // close pack pickup orders 24h before the stop
export function dropForStop(startsAtISO: string): { sat: Date; cutoff: Date } {
  const pickup = new Date(startsAtISO);
  return { sat: pickup, cutoff: new Date(pickup.getTime() - STOP_LEAD_MS) };
}
/**
 * The pack drop a customer can still reserve for — the choice /api/reserve offers, said in one
 * place for the screens that quote it (2026-10-04): the first UPCOMING stop whose cutoff is still
 * ahead; the Saturday cadence only when nothing is scheduled at all; null when stops are scheduled
 * and every one of their cutoffs has passed (the reserve page then shows what is left — no date to
 * quote here). The drink sheet used to quote the stop the cup window was about, which during a stop
 * is the stop under way: "reserve by" a time that had already gone.
 */
export function packDropFrom(stopStarts: readonly string[], now: Date = new Date()): { sat: Date; cutoff: Date } | null {
  const t = now.getTime();
  const future = stopStarts.map((s) => Date.parse(s)).filter((ms) => Number.isFinite(ms) && ms > t).sort((a, b) => a - b);
  if (future.length === 0) return nextDrop(now);
  for (const ms of future) { const d = dropForStop(new Date(ms).toISOString()); if (d.cutoff.getTime() > t) return d; }
  return null;
}
// the drop-date string both sides agree on — the ET business day (lib/delivery.ts convention),
// NOT a UTC slice: a stop at/after 8pm ET would land on the next UTC day and split the drop
// sheet, reservations, and brew links across two dates.
export const dropDateKey = (d: Date): string => etDayKey(d);

// ── à-la-carte pre-order window ──
// Moved to lib/ordering (2026-10-04), which answers the whole question — open or not, for which
// stop, made when — for the phone and /api/checkout alike. These names stay importable from here
// because the pack-pricing callers and the smoke suite know them by this address.
export { PREORDER_LEAD_MS, PREORDER_TAIL_MS, preorderWindow, preorderLeadMs, type PreorderWindow } from "./ordering";
