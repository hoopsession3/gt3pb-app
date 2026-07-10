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
// the drop-date string both sides agree on — the ET business day (lib/delivery.ts convention),
// NOT a UTC slice: a stop at/after 8pm ET would land on the next UTC day and split the drop
// sheet, reservations, and brew links across two dates.
export const dropDateKey = (d: Date): string => etDayKey(d);

// ── à-la-carte pre-order window ──
// A cup pre-order promises "ready in ~8 min", which is only true when there's a truck to make it.
// Rule: pre-orders are accepted while the truck is LIVE, or inside the window around the next
// scheduled stop — from 4h before its start (crew is heading in / on site) until 8h after (a
// service day), so a missed "go live" toggle doesn't strand customers. Outside that, the app
// offers the pack reserve instead. Pure + injectable clock; enforced client-side (the sheet) AND
// server-side (/api/checkout) with this same function.
export const PREORDER_LEAD_MS = 4 * 60 * 60 * 1000;
export const PREORDER_TAIL_MS = 8 * 60 * 60 * 1000;
export type PreorderWindow = { open: boolean; reason: "live" | "window" | "early" | "none" };
// `leadMs` is the operator's dial (live_status.preorder_lead_h, 0137): how long before a stop cup
// orders open. leadMs <= 0 means STRICT live-only — no window at all, the go-live toggle is the
// gate (the tail exists to survive a missed toggle, so strict mode drops it too).
export function preorderWindow(nowMs: number, isLive: boolean, nextStartISO: string | null | undefined, leadMs: number = PREORDER_LEAD_MS): PreorderWindow {
  if (isLive) return { open: true, reason: "live" };
  if (leadMs <= 0) return { open: false, reason: "none" };
  if (!nextStartISO) return { open: false, reason: "none" };
  const start = Date.parse(nextStartISO);
  if (!Number.isFinite(start)) return { open: false, reason: "none" };
  if (nowMs >= start - leadMs && nowMs <= start + PREORDER_TAIL_MS) return { open: true, reason: "window" };
  return { open: false, reason: "early" };
}
export const preorderLeadMs = (hours: number | null | undefined): number =>
  typeof hours === "number" && Number.isFinite(hours) ? Math.max(0, hours) * 60 * 60 * 1000 : PREORDER_LEAD_MS;
