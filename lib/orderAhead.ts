// ORDER-AHEAD — single source of truth for the Saturday-drop reserve model. Pure + deterministic
// (no DOM, no env) so it runs identically on the server (authoritative price + cutoff), in the client
// UI, and under the smoke suite. Ported from the approved reference build (gt3pb-orderahead-app-v1.0).
//
// MODEL: one-off pre-orders only — no subscription, no deposit, no recurring billing. Order by
// Wed 18:00 local, pick up the following Saturday. Bring bottles back for pack pricing, or new glass
// at a flat $10. The 70% margin floor lives in this grid: no promo codes, no rounding, no extra
// discounts anywhere.

export const PRICING = {
  // order-ahead + bring bottles back
  returnPacks: { 3: 22.5, 6: 42.0, 12: 78.0 } as Record<number, number>,
  // order-ahead, new glass — flat per bottle, NO pack discount
  newPerBottle: 10.0,
  // walk-up reference copy (in-person at the truck)
  walkup: { newGlass: 10, bringBack: 8, single: 10 },
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
// what a return pack saves vs paying $10/bottle for new glass (only shown on the return path)
export const saveAmount = (size: number): number => Math.round(newGlassTotal(size) - (PRICING.returnPacks[size] ?? newGlassTotal(size)));
export const perBottle = (size: number, glass: GlassPath): number => packTotal(size, glass) / size;
export const toCents = (dollars: number): number => Math.round(dollars * 100);
export const dollars = (n: number): string => "$" + (n % 1 ? n.toFixed(2) : n.toLocaleString());

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
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  return dropDateISO.slice(0, 10) === sat.toISOString().slice(0, 10);
}

// The pickup always follows the truck's NEXT scheduled stop: pickup = that stop's date, and ordering
// closes a few hours before it so there's time to brew to order. Used when a stop is scheduled; the
// Saturday nextDrop() above is the fallback when the route is empty.
const STOP_LEAD_MS = 3 * 60 * 60 * 1000; // close ordering 3h before the stop
export function dropForStop(startsAtISO: string): { sat: Date; cutoff: Date } {
  const pickup = new Date(startsAtISO);
  return { sat: pickup, cutoff: new Date(pickup.getTime() - STOP_LEAD_MS) };
}
// the drop-date string both sides agree on (UTC date slice), so client display and server validation match
export const dropDateKey = (d: Date): string => d.toISOString().slice(0, 10);
