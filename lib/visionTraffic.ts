// HOW THE TRAFFIC COMES (R55, phase C of the investor-ready vision — Ryan, 2026-10-25: "every initiative must explain
// how traffic will actually be generated… Reach → Conversion → First Purchase → Repeat Purchase → Retention → Revenue…
// customer acquisition cost, lifetime value, average order value, repeat purchase frequency, channel contribution… adjust
// assumptions and instantly see how revenue projections, profitability and returns change").
//
// Pure. Each channel is what Ryan expects of it: how many people it reaches a month, how many of them order a first time,
// what it costs a month, the month it starts. Guests who've ordered come back at a rate (orders a month per returning
// guest) and stay at a rate (kept, month to month). From those: new guests and orders month by month, by channel; what a
// new guest costs (CAC); what a guest is worth over their visits, after the cost of goods (LTV); and the orders a day the
// channels bring — set beside the plan's own "orders a day", so the two can't quietly disagree. Nothing here is a
// benchmark: a channel without numbers brings no one, and says so.
import { MONTHS, dollars } from "./finance";

export const CHANNEL_KINDS = ["local", "social", "events", "offices", "loyalty", "partners", "paid"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const CHANNEL_KIND: Record<ChannelKind, { name: string; says: string }> = {
  local:    { name: "Local search & word of mouth", says: "Maps, reviews, people telling people — reach is who walks or searches by." },
  social:   { name: "Social & creators",            says: "Our posts and the creators who carry us — reach is who sees them." },
  events:   { name: "Events & experiences",         says: "Races, markets, gym takeovers, tastings — reach is who's there." },
  offices:  { name: "Office accounts & deliveries", says: "Recurring office orders — reach is the people at the offices we serve." },
  loyalty:  { name: "Referrals, subscriptions & loyalty", says: "Guests bringing guests; packs and the club — reach is who's asked." },
  partners: { name: "Partnerships",                 says: "A gym, a studio, a café that sends its people — reach is their members." },
  paid:     { name: "Paid ads",                     says: "Only where the numbers justify it — reach is impressions that land." },
};
import type { TrafficChannel } from "./visionMoney";
export type { TrafficChannel };
export type Retention = { repeatPerMonth: number | null; keptPct: number | null };

export type ChannelMonth = { newGuests: number; returning: number; orders: number };
export type Traffic = {
  ok: boolean; missing: string[];
  months: { m: number; newGuests: number; returning: number; orders: number; cost: number; byChannel: ChannelMonth[] }[];
  /** What a new guest costs, each channel and all together (null: it brings no one, or costs nothing). */
  cac: (number | null)[]; blendedCac: number | null;
  /** Orders a guest places over their time with us: the first, then `repeat` a month while kept. */
  ordersPerGuest: number | null;
  /** What a guest is worth after the cost of goods and fees: orders × average order × the margin. */
  ltv: number | null;
  /** The orders a day the channels bring, at month 12 and month 36. */
  perDay12: number | null; perDay36: number | null;
};

/** The model, 36 months. `aovCents` and `marginPct` come from the plan's money (the average order; goods and fees out). */
export function traffic(channels: readonly TrafficChannel[], ret: Retention, aovCents: number | null, marginPct: number | null, daysOpen: number | null): Traffic {
  const missing: string[] = [];
  if (!channels.length) missing.push("a channel");
  if (ret.repeatPerMonth == null) missing.push("how often a guest comes back");
  if (ret.keptPct == null) missing.push("how many guests stay month to month");
  if (missing.length) return { ok: false, missing, months: [], cac: [], blendedCac: null, ordersPerGuest: null, ltv: null, perDay12: null, perDay36: null };
  const keep = Math.min(0.99, Math.max(0, ret.keptPct! / 100)), repeat = Math.max(0, ret.repeatPerMonth!);
  const pools = channels.map(() => 0);
  const months: Traffic["months"] = [];
  const newBy = channels.map(() => 0), costBy = channels.map(() => 0);
  for (let m = 1; m <= MONTHS; m++) {
    const byChannel = channels.map((c, k) => {
      const live = m >= Math.max(1, c.startMonth || 1);
      const fresh = live ? (Math.max(0, c.reach) * Math.max(0, c.convertPct)) / 100 : 0;
      const returning = pools[k];                       // last month's guests who stayed, coming back this month
      const orders = fresh + returning * repeat;
      pools[k] = (pools[k] + fresh) * keep;             // who's still ours next month
      if (live) { newBy[k] += fresh; costBy[k] += Math.max(0, c.costCents); }
      return { newGuests: fresh, returning, orders };
    });
    months.push({ m, newGuests: sum(byChannel.map((x) => x.newGuests)), returning: sum(byChannel.map((x) => x.returning)), orders: sum(byChannel.map((x) => x.orders)),
      cost: sum(channels.map((c) => (m >= Math.max(1, c.startMonth || 1) ? Math.max(0, c.costCents) : 0))), byChannel });
  }
  const cac = channels.map((_, k) => (newBy[k] > 0 && costBy[k] > 0 ? costBy[k] / newBy[k] : null));
  const allNew = sum(newBy), allCost = sum(costBy);
  // Orders a guest places: the first, then each month they're kept, `repeat` more: 1 + repeat × (k + k² + …) = 1 + repeat × k ÷ (1 − k).
  const ordersPerGuest = 1 + (repeat * keep) / (1 - keep);
  const ltv = aovCents != null && marginPct != null ? ordersPerGuest * aovCents * (marginPct / 100) : null;
  const perDay = (m: number) => (daysOpen ? months[m - 1].orders / daysOpen : null);
  return { ok: true, missing: [], months, cac, blendedCac: allNew > 0 && allCost > 0 ? allCost / allNew : null, ordersPerGuest, ltv, perDay12: perDay(12), perDay36: perDay(36) };
}
const sum = (a: number[]) => a.reduce((n, x) => n + x, 0);

/** Each channel's share of month 12's orders, largest first — who actually brings the traffic. */
export function contribution(t: Traffic, channels: readonly TrafficChannel[], month = 12): { label: string; kind: ChannelKind; orders: number; share: number }[] {
  if (!t.ok) return [];
  const mo = t.months[month - 1], total = mo.orders || 1;
  return channels.map((c, k) => ({ label: c.label || CHANNEL_KIND[c.kind].name, kind: c.kind, orders: mo.byChannel[k].orders, share: mo.byChannel[k].orders / total }))
    .sort((a, b) => b.orders - a.orders);
}

/** Where the channels and the plan disagree — arithmetic on Ryan's own numbers, never a benchmark. */
export function trafficFlags(t: Traffic, channels: readonly TrafficChannel[], planPerDay: number | null, marketingCents: number): { level: "stop" | "look"; words: string }[] {
  const out: { level: "stop" | "look"; words: string }[] = [];
  if (!t.ok) return [{ level: "look", words: `Set ${t.missing.join(", ")} to see where the traffic comes from.` }];
  for (const [k, c] of channels.entries()) {
    if (c.costCents > 0 && (!c.reach || !c.convertPct)) out.push({ level: "look", words: `${c.label || CHANNEL_KIND[c.kind].name} costs ${dollars(c.costCents)} a month and brings no one on these numbers.` });
    const cac = t.cac[k];
    if (cac != null && t.ltv != null && cac > t.ltv) out.push({ level: "stop", words: `${c.label || CHANNEL_KIND[c.kind].name}: a new guest costs ${dollars(cac)} and is worth ${dollars(t.ltv)} over their visits — it loses money on every guest it brings.` });
  }
  if (planPerDay != null && t.perDay12 != null && planPerDay > 0) {
    const gap = (t.perDay12 - planPerDay) / planPerDay;
    if (Math.abs(gap) > 0.2) out.push({ level: "look", words: `The plan counts on ${round1(planPerDay)} orders a day; the channels bring ${round1(t.perDay12)} by month 12 — ${gap < 0 ? "they don't reach it" : "more than the plan uses"}.` });
  }
  const spend = t.months[11]?.cost ?? 0;
  if (marketingCents > 0 && spend > 0 && Math.abs(spend - marketingCents) / marketingCents > 0.2)
    out.push({ level: "look", words: `The channels cost ${dollars(spend)} a month; the money model has ${dollars(marketingCents)} for marketing.` });
  return out;
}
const round1 = (v: number) => Math.round(v * 10) / 10;
