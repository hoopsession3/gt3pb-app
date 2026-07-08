// DELIVERY — Sunday-morning pre-order delivery (Phase 1, direct channel). Pure logic only:
// pricing, the refill constraint, the Friday-6PM→Sunday cutoff math, and the zone list.
// Everything here is deterministic + injectable-clock so the smoke suite (CI) proves the money
// math with the debrief's own QA samples. UI and the charge API both import from here — one truth.
//
// Channel note (Phase 2-proofing): the Loop/refill tier exists ONLY on the direct channel — a
// third-party driver can't verify empties. `refillAllowed(channel)` is the single gate.

export type DeliveryChannel = "direct" | "uber_eats" | "doordash" | "instacart";
export type DeliveryPackSize = 12 | 24 | 36;
export const DELIVERY_PACKS: readonly DeliveryPackSize[] = [12, 24, 36] as const;

export const DELIVERY_PRICING = {
  refill: 8_00,        // Loop tier — into a returned bottle (direct channel only)
  fresh: 10_00,        // new sealed bottle
  performance: 14_00,  // always a fresh bottle
  feeCents: 10_00,     // flat delivery fee…
  feeWaivedAt: 24,     // …waived at 24+ bottles
} as const;

export const PERF_BASES = ["rise", "flow", "dusk"] as const;
export const PERF_ADDINS = ["mct_oil", "grass_fed_butter"] as const;
export type PerfBase = (typeof PERF_BASES)[number];
export type PerfAddin = (typeof PERF_ADDINS)[number];
/** counts per base+addin combo, e.g. { "rise|mct_oil": 2 } */
export type PerfMix = Record<string, number>;
export const perfKey = (b: PerfBase, a: PerfAddin) => `${b}|${a}`;
export const perfTotal = (mix: PerfMix) => Object.values(mix).reduce((s, n) => s + (n || 0), 0);

export const refillAllowed = (channel: DeliveryChannel) => channel === "direct";

/** Max bottles that may be refills: Performance always ships fresh. */
export const maxRefills = (totalBottles: number, performanceCount: number) =>
  Math.max(0, totalBottles - performanceCount);

export interface DeliveryQuote {
  refillCount: number; newCount: number; performanceCount: number;
  bottleSubtotalCents: number; deliveryFeeCents: number; totalCents: number; // pre-tax
}

/** The money math — clamps refills to the constraint; callers should validate first for UX. */
export function quoteDelivery(
  packSize: number, performanceCount: number, requestedRefills: number, channel: DeliveryChannel = "direct"
): DeliveryQuote {
  const perf = Math.max(0, Math.min(performanceCount, packSize));
  const refills = refillAllowed(channel) ? Math.max(0, Math.min(requestedRefills, maxRefills(packSize, perf))) : 0;
  const fresh = packSize - perf - refills;
  const bottleSubtotalCents =
    refills * DELIVERY_PRICING.refill + fresh * DELIVERY_PRICING.fresh + perf * DELIVERY_PRICING.performance;
  const deliveryFeeCents = packSize >= DELIVERY_PRICING.feeWaivedAt ? 0 : DELIVERY_PRICING.feeCents;
  return { refillCount: refills, newCount: fresh, performanceCount: perf, bottleSubtotalCents, deliveryFeeCents, totalCents: bottleSubtotalCents + deliveryFeeCents };
}

// ── cutoff → delivery-date math (America/New_York, injectable clock) ──
// Order before Friday 6:00 PM ET of week N → delivered Sunday of week N.
// After → Sunday of week N+1. Computed in ET explicitly so a UTC server and a local
// phone always agree (the reserve flow's TZ lesson, fixed at the source).
const ET = "America/New_York";
function etParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number; dow: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(ms)) p[part.type] = part.value;
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: dows.indexOf(p.weekday) };
}
const DAY = 24 * 60 * 60 * 1000;

export interface DeliverySlot { deliveryDateKey: string; cutoffLabel: string; deliveryLabel: string }
/** The next open Sunday slot for an order placed at `nowMs` (its cutoff is always ahead). */
export function nextDeliverySlot(nowMs: number): DeliverySlot {
  const now = etParts(nowMs);
  // Cutoff for the coming Sunday is its Friday 18:00 ET. Fri post-6, Sat, and Sunday itself
  // all roll to the following Sunday.
  const cutoffPassed = (now.dow === 5 && now.h >= 18) || now.dow === 6 || now.dow === 0;
  let daysToSunday = (7 - now.dow) % 7;            // Mon→6 … Fri→2, Sat→1, Sun→0
  if (cutoffPassed) daysToSunday += now.dow === 0 ? 7 : 7; // roll a week (Sun: 0+7, Fri/Sat: +7)
  const sun = etParts(nowMs + daysToSunday * DAY);
  const fri = etParts(nowMs + (daysToSunday - 2) * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  const mos = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    deliveryDateKey: `${sun.y}-${pad(sun.mo)}-${pad(sun.d)}`,
    cutoffLabel: `Fri, ${mos[fri.mo]} ${fri.d}, 6:00 PM`,
    deliveryLabel: `Sunday, ${mos[sun.mo]} ${sun.d}, 5–8 AM`,
  };
}

// ── Phase-1 zone (ZIP allowlist). Ryan verifies against the 20-mi radius before launch. ──
export const DELIVERY_ZIPS: readonly string[] = [
  "29601", "29605", "29607", "29609", "29611", "29615", "29617", // Greenville
  "29650", "29651",                                              // Greer
  "29680", "29681",                                              // Simpsonville
  "29662",                                                       // Mauldin
  "29690",                                                       // Travelers Rest
] as const;
export const zipInZone = (zip: string) => DELIVERY_ZIPS.includes(zip.trim().slice(0, 5));
