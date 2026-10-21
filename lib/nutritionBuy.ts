// GT3 NUTRITION, BOUGHT (R46) — what the course is in the catalog, and what buying it writes. Pure: the checkout route
// (app/api/nutrition/checkout), the course page (components/nutrition/CourseBuy) and the tests all ask it.
//
// One purchase, one time, opens all of it (Ryan, 2026-10-20/21): the course's product is the one shop_products row of
// kind 'program_tier' with program_tier 'pro' (0443), and buying it is a live program_access row of that tier on the
// buyer's customer record — the row every lesson (0442) and every course map (app/api/nutrition/map) asks for.
import { money } from "./money";

/** The access tier the purchase gives — the one "primal lessons read" asks for. */
export const COURSE_TIER = "pro";

/** The access row a paid order writes: theirs, live, bought, tied to the order that bought it (a refund revokes it). */
export function courseAccessRow(customerId: string, orderId: string): {
  customer_id: string; tier: string; source: "purchase"; order_id: string; revoked_at: null; granted_at: string;
} {
  return { customer_id: customerId, tier: COURSE_TIER, source: "purchase", order_id: orderId, revoked_at: null, granted_at: new Date().toISOString() };
}

/** What the buy button says: the price as the catalog has it, never a number written into the page. */
export function buyLabel(priceCents: number | null | undefined): string {
  const c = Number(priceCents);
  if (!Number.isFinite(c) || c <= 0) return "Get GT3 Nutrition";
  return `Get GT3 Nutrition — ${money(c)}`;
}
