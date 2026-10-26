// THE MONEY, PLAN BY PLAN — ONE ENGINE, EVERY NUMBER TRACEABLE (R54, phase B; reworked the same day after the financial
// traceability audit — Ryan, 2026-10-25: "I want to click any financial number in GT3 and answer: where did this number
// come from? What makes it up? How was it calculated? What happens if I change it? What else in the business does it
// affect?"; decisions: working capital is a reserve held apart from startup spending; card fees are an operating expense,
// below gross margin; owners alone approve a baseline).
//
// Pure: inputs in, 36 months out, and for every figure its trace — what it means, its formula, the formula with the
// numbers in it, the inputs it's made of, whether it's assumed (typed), observed (GT3's own sales), computed or
// simulated, the period it covers, and what it feeds. DEPS below is the one dependency map: the drill-down's "made of"
// and "feeds", the what-if's "this moved because", and the tests all read it — there is no second copy to drift.
//
// Nothing here is a benchmark: an input not set is named as missing and nothing is computed from it.
import { MONTHS, breakEvenMonth, dollars, paybackMonth, roi } from "./finance";
import { traffic, type Traffic } from "./visionTraffic";

export { MONTHS, dollars };

/** A traffic channel (its model is lib/visionTraffic, R55): what it reaches a month, the share who order a first time,
 *  what it costs a month, the month it starts. Kept with the scenario's inputs, so one save holds the whole plan. */
export type TrafficChannel = { kind: "local" | "social" | "events" | "offices" | "loyalty" | "partners" | "paid"; label: string; reach: number; convertPct: number; costCents: number; startMonth: number };

// ── what the money buys ─────────────────────────────────────────────────────────────────────────────────────────────
export const CATEGORIES = ["equipment", "buildout", "permits", "inventory", "tech", "launch", "services", "contingency", "deposits", "other", "reserve"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_WORD: Record<Category, string> = {
  equipment: "Equipment & fixtures", buildout: "Construction & build-out", permits: "Permits & licensing", inventory: "Opening inventory",
  tech: "Technology & POS", launch: "Marketing & launch", services: "Professional services", contingency: "Contingency", deposits: "Deposits",
  other: "Other startup costs", reserve: "Working-capital reserve",
};
export const CONFIDENCES = ["quoted", "estimated", "guess"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_WORD: Record<Confidence, string> = { quoted: "Quoted", estimated: "Estimated", guess: "A guess" };
/** One line of what the money buys. Its total is quantity × unit cost — never typed separately, so it can't disagree. A
 *  line without a unit cost is unpriced: listed, counted as unpriced, never given a number. */
export type UseLine = { id: string; label: string; category: Category; qty: number | null; unitCents: number | null; source: string | null; on: string | null; confidence: Confidence | null; notes: string | null };
export const lineTotal = (l: Pick<UseLine, "qty" | "unitCents">): number | null => (l.unitCents == null ? null : Math.round((l.qty ?? 1) * l.unitCents));

const OLD_KIND: Record<string, Category> = { build: "buildout", equipment: "equipment", permits: "permits", deposit: "deposits", inventory: "inventory", working_capital: "reserve", other: "other" };
let seq = 0;
/** Lines as saved — or as R54's first draft saved them ({label, kind, cents}): read into the itemized shape, unchanged in
 *  amount (one of each at its total), the old "working capital" becoming the reserve. */
export function toLines(raw: unknown): UseLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r): UseLine => {
    const o = (r ?? {}) as Record<string, unknown>;
    const legacy = o.kind != null && o.category == null;
    const category = (legacy ? OLD_KIND[String(o.kind)] ?? "other" : (CATEGORIES as readonly string[]).includes(String(o.category)) ? o.category : "other") as Category;
    const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      id: String(o.id ?? `l${++seq}`), label: String(o.label ?? ""), category,
      qty: legacy ? 1 : num(o.qty), unitCents: legacy ? num(o.cents) : num(o.unitCents),
      source: (o.source as string) ?? null, on: (o.on as string) ?? null,
      confidence: (CONFIDENCES as readonly string[]).includes(String(o.confidence)) ? (o.confidence as Confidence) : null, notes: (o.notes as string) ?? null,
    };
  });
}

/** One scenario's inputs. A null is "not set" — never zero by accident. */
export type Inputs = {
  uses: UseLine[];
  ordersPerDay: number | null;      // at full stride
  avgOrderCents: number | null;
  daysOpenPerMonth: number | null;
  hoursOpenPerDay: number | null;
  rampMonths: number;               // months to full stride (0 = from day one)
  rampStartPct: number;             // where it starts, as % of full stride
  growthPctPerYear: number;         // after the ramp
  cogsPct: number | null;           // of sales: ingredients, packaging, other direct costs
  cardFeePct: number;               // of sales — an operating expense, below gross margin (Ryan, 2026-10-25)
  staffHoursPerDay: number | null;
  wageCents: number | null;         // per hour
  laborBurdenPct: number;           // payroll taxes and the like, on top of wages
  rentCents: number;                // a month, fixed
  rentPctOfSales: number;           // a share of sales (a gym's, a partner's terms)
  otherOpexCents: number;           // a month: utilities, insurance, software, repairs
  marketingCents: number;           // a month
  ownerCashCents: number;           // the owners' own money in at opening (beside the investor's)
  // Phase C (R55) — the traffic, and the room's hours: set beside the 36 months.
  channels: TrafficChannel[];
  repeatPerMonth: number | null;
  keptPct: number | null;
  peakFactor: number | null;
  slowFactor: number | null;
  serveSec: number | null;
  /** Where the 36 months' orders come from (R55 — "link, don't copy"): the typed orders a day, or the channels above,
   *  live — change a channel and the money moves. With the channels, marketing is what they cost, month by month. */
  demandFrom: "typed" | "channels";
  /** Cap each month's orders at what the room's counter can take over the hours open (R55). The capacity comes from the
   *  plan's room as drawn (lib/visionRoom), read live, never copied in. */
  capToRoom: boolean;
  /** The product mix (R62 — the audit's gap 7: "Gross margin → product sales → ingredient costs → packaging → other direct
   *  costs"): each product's share of orders, its price, what it costs to make and to pack — from the catalog or typed.
   *  When `mixDrives`, the average order and the cost of goods are worked out from it, live; until then they're typed. */
  mix: MixLine[];
  mixDrives: boolean;
  itemsPerOrder: number;
};
export type MixLine = { key: string; label: string; sharePct: number; priceCents: number | null; unitCostCents: number | null; packagingCents: number | null };
/** What the engine reads from outside the inputs: the plan's room's counter, orders an hour (null: no room drawn). */
export type Context = { counterPerHour: number | null };
export const BLANK: Inputs = {
  uses: [], ordersPerDay: null, avgOrderCents: null, daysOpenPerMonth: null, hoursOpenPerDay: null, rampMonths: 0, rampStartPct: 100,
  growthPctPerYear: 0, cogsPct: null, cardFeePct: 0, staffHoursPerDay: null, wageCents: null, laborBurdenPct: 0, rentCents: 0,
  rentPctOfSales: 0, otherOpexCents: 0, marketingCents: 0, ownerCashCents: 0,
  channels: [], repeatPerMonth: null, keptPct: null, peakFactor: null, slowFactor: null, serveSec: null, demandFrom: "typed", capToRoom: false, mix: [], mixDrives: false, itemsPerOrder: 1,
};
/** Saved inputs, read whole: every field present, the lines itemized. */
export const toInputs = (p?: Partial<Inputs> | Record<string, unknown> | null): Inputs => {
  const o = (p ?? {}) as Partial<Inputs>;
  return { ...BLANK, ...o, uses: toLines((o as { uses?: unknown }).uses), channels: Array.isArray(o.channels) ? o.channels : [], mix: Array.isArray(o.mix) ? o.mix : [] };
};

/** The mix, worked out: the average order (Σ share × price × items an order) and the cost of goods (Σ share × (cost +
 *  packing) ÷ Σ share × price). Null when it can't be: shares not adding to 100, or a product without its price or cost. */
export function mixOf(i: Pick<Inputs, "mix" | "itemsPerOrder">): { aovCents: number; cogsPct: number; problems: string[] } | null {
  const problems: string[] = [];
  if (!i.mix.length) return null;
  const share = i.mix.reduce((n, l) => n + (l.sharePct || 0), 0);
  if (Math.abs(share - 100) > 0.5) problems.push(`the shares add to ${Math.round(share * 10) / 10}%, not 100%`);
  const unpriced = i.mix.filter((l) => l.priceCents == null || l.unitCostCents == null);
  if (unpriced.length) problems.push(`${unpriced.map((l) => l.label || "a product").join(", ")} ${unpriced.length === 1 ? "needs" : "need"} a price and a cost`);
  if (problems.length) return { aovCents: 0, cogsPct: 0, problems };
  const per = i.mix.reduce((n, l) => n + (l.sharePct / 100) * l.priceCents!, 0);
  const cost = i.mix.reduce((n, l) => n + (l.sharePct / 100) * (l.unitCostCents! + (l.packagingCents ?? 0)), 0);
  return { aovCents: Math.round(per * Math.max(1, i.itemsPerOrder || 1)), cogsPct: per > 0 ? (cost / per) * 100 : 0, problems: [] };
}
/** The inputs the 36 months run on: the mix's average order and cost of goods where the mix drives them. */
export function effective(i: Inputs): Inputs {
  if (!i.mixDrives) return i;
  const m = mixOf(i);
  return m && !m.problems.length ? { ...i, avgOrderCents: m.aovCents, cogsPct: m.cogsPct } : { ...i, avgOrderCents: null, cogsPct: null };
}
export const SCENARIOS = ["conservative", "base", "upside"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const SCENARIO_WORD: Record<Scenario, string> = { conservative: "Conservative", base: "Base", upside: "Upside" };

export type Structure =
  | { kind: "none" }
  | { kind: "loan"; amountCents: number; aprPct: number; termMonths: number }
  | { kind: "rev_share"; amountCents: number; sharePct: number; capMultiple: number }
  | { kind: "equity"; amountCents: number; ownershipPct: number; payoutPct: number }
  | { kind: "safe"; amountCents: number; capCents: number; discountPct: number };
export const STRUCTURE_WORD: Record<Structure["kind"], string> = {
  none: "Not set", loan: "Loan", rev_share: "Revenue share", equity: "Equity", safe: "SAFE / convertible note",
};

/** The inputs a model can't run without, by name — what the screen asks for first. */
export function missing(raw: Inputs, ctx: Context = NO_ROOM): string[] {
  const out: string[] = [];
  if (raw.mixDrives) { const mx = mixOf(raw); if (!mx) out.push("the product mix"); else out.push(...mx.problems.map((p) => `the mix (${p})`)); }
  const i = effective(raw);
  if (i.demandFrom === "channels") { if (!i.channels.length) out.push("a traffic channel"); if (i.repeatPerMonth == null) out.push("how often a guest comes back"); if (i.keptPct == null) out.push("how many guests stay"); }
  else if (i.ordersPerDay == null) out.push("orders a day");
  if (i.capToRoom && ctx.counterPerHour == null) out.push("the plan's room (draw it to cap sales by its counter)");
  if (i.capToRoom && i.hoursOpenPerDay == null) out.push("hours open a day");
  if (i.avgOrderCents == null && !raw.mixDrives) out.push("the average order");
  if (i.daysOpenPerMonth == null) out.push("days open a month");
  if (i.cogsPct == null && !raw.mixDrives) out.push("cost of goods");
  if (i.staffHoursPerDay == null) out.push("staff hours a day");
  if (i.wageCents == null) out.push("the wage");
  return out;
}

export const NO_ROOM: Context = { counterPerHour: null };
export type Month = {
  m: number; orders: number; ordersAsked: number; ordersLost: number; revenue: number; cogs: number; grossProfit: number;
  fees: number; labor: number; rent: number; opex: number; marketing: number; operatingExpenses: number;
  operating: number;        // what the business makes before paying its investor
  toInvestor: number;       // what it pays the investor this month (the structure's)
  net: number;              // operating − toInvestor
  cumulative: number;       // cash on hand: the funding raised − startup spending + every month's net so far
};
export type Model = {
  ok: boolean; missing: string[];
  /** What's spent before opening: every priced line but the reserve. */
  startupSpend: number;
  /** Cash held at opening to carry the early months (the reserve lines) — not spent. */
  reservePlanned: number;
  /** Lines listed without a price — not in any total. */
  unpriced: number;
  /** The deepest the running net cash (operating − investor payments) goes below zero: the cash the early months need. */
  reserveNeeded: number;
  /** startupSpend + reserveNeeded: what must be raised so cash never goes below zero. */
  requiredFunding: number;
  /** The investor's money + the owners' own. */
  fundingRaised: number;
  months: Month[];
  /** Where the orders came from, and what the room couldn't take (orders and sales, 36 months). */
  demandFrom: "typed" | "channels"; capPerMonth: number | null; cappedMonths: number; ordersLost: number; salesLost: number;
  traffic: Traffic | null;
  years: { year: number; revenue: number; cogs: number; grossProfit: number; operatingExpenses: number; operating: number; toInvestor: number; net: number }[];
  breakEvenMonth: number | null;       // from which the business makes money every month to 36 — before the investor
  breakEvenAfterMonth: number | null;  // the same, after the investor is paid
  paybackMonth: number | null;         // operating cash has earned back startup spending — before the investor
  paybackAfterMonth: number | null;    // net cash has — after the investor
  roiBusiness: number | null;          // (Σ operating − startup spending) ÷ startup spending — 36 months, before financing, before tax
  roiAfter: number | null;             // (Σ net − startup spending) ÷ startup spending — after the investor is paid
  grossMarginPct: number | null;       // (sales − cost of goods) ÷ sales
};

const r2 = (v: number) => Math.round(v);
const sum = (a: number[]) => a.reduce((n, x) => n + x, 0);

/** 36 months of one scenario, under one structure. Cents throughout; a month is `daysOpenPerMonth` days open. */
export function project(raw: Inputs, structure: Structure = { kind: "none" }, ctx: Context = NO_ROOM): Model {
  const miss = missing(raw, ctx);
  const i = effective(raw);
  const priced = i.uses.map((l) => ({ l, t: lineTotal(l) }));
  const startupSpend = sum(priced.filter((x) => x.l.category !== "reserve" && x.t != null).map((x) => Math.max(0, x.t!)));
  const reservePlanned = sum(priced.filter((x) => x.l.category === "reserve" && x.t != null).map((x) => Math.max(0, x.t!)));
  const unpriced = priced.filter((x) => x.t == null).length;
  const fundingRaised = (structure.kind === "none" ? 0 : structure.amountCents) + Math.max(0, i.ownerCashCents || 0);
  const empty: Model = { ok: false, missing: miss, startupSpend, reservePlanned, unpriced, reserveNeeded: 0, requiredFunding: startupSpend, fundingRaised, months: [], years: [],
    demandFrom: i.demandFrom, capPerMonth: null, cappedMonths: 0, ordersLost: 0, salesLost: 0, traffic: null,
    breakEvenMonth: null, breakEvenAfterMonth: null, paybackMonth: null, paybackAfterMonth: null, roiBusiness: null, roiAfter: null, grossMarginPct: null };
  if (miss.length) return empty;
  const days = i.daysOpenPerMonth!, aov = i.avgOrderCents!;
  // The channels, live: their orders month by month, and their cost as the marketing (the margin a guest is worth is
  // the sales less goods and card fees — from the inputs, so there's no loop through the model).
  const tr = i.demandFrom === "channels" ? traffic(i.channels, { repeatPerMonth: i.repeatPerMonth, keptPct: i.keptPct }, aov, 100 - i.cogsPct! - i.cardFeePct, days) : null;
  if (tr && !tr.ok) return { ...empty, ok: false, missing: tr.missing };
  const capPerMonth = i.capToRoom && ctx.counterPerHour != null && i.hoursOpenPerDay != null ? ctx.counterPerHour * i.hoursOpenPerDay * days : null;
  let owedCap = structure.kind === "rev_share" ? structure.amountCents * structure.capMultiple : 0;
  const pmt = structure.kind === "loan" ? loanPayment(structure.amountCents, structure.aprPct, structure.termMonths) : 0;
  const months: Month[] = [];
  let run = 0, lowest = 0, cum = fundingRaised - startupSpend;
  for (let m = 1; m <= MONTHS; m++) {
    const ramp = i.rampMonths > 0 && m <= i.rampMonths ? (i.rampStartPct + ((100 - i.rampStartPct) * (m - 1)) / i.rampMonths) / 100 : 1;
    const grow = Math.pow(1 + i.growthPctPerYear / 100, Math.floor((m - 1) / 12));
    const asked = tr ? tr.months[m - 1].orders : i.ordersPerDay! * ramp * grow * days;
    const orders = capPerMonth != null ? Math.min(asked, capPerMonth) : asked;
    const revenue = orders * aov;
    const marketing = tr ? tr.months[m - 1].cost : i.marketingCents;
    const cogs = (revenue * i.cogsPct!) / 100;
    const fees = (revenue * i.cardFeePct) / 100;
    const labor = i.staffHoursPerDay! * days * i.wageCents! * (1 + i.laborBurdenPct / 100);
    const rent = i.rentCents + (revenue * i.rentPctOfSales) / 100;
    const operatingExpenses = fees + labor + rent + i.otherOpexCents + marketing;
    const operating = revenue - cogs - operatingExpenses;
    let toInvestor = 0;
    if (structure.kind === "loan" && m <= structure.termMonths) toInvestor = pmt;
    else if (structure.kind === "rev_share" && owedCap > 0) { toInvestor = Math.min(owedCap, (revenue * structure.sharePct) / 100); owedCap -= toInvestor; }
    else if (structure.kind === "equity") toInvestor = Math.max(0, operating) * (structure.ownershipPct / 100) * (structure.payoutPct / 100);
    const net = operating - toInvestor;
    run += net; cum += net; lowest = Math.min(lowest, run);
    months.push({ m, orders: r2(orders), ordersAsked: r2(asked), ordersLost: r2(asked - orders), revenue: r2(revenue), cogs: r2(cogs), grossProfit: r2(revenue - cogs), fees: r2(fees), labor: r2(labor), rent: r2(rent),
      opex: i.otherOpexCents, marketing: r2(marketing), operatingExpenses: r2(operatingExpenses), operating: r2(operating), toInvestor: r2(toInvestor), net: r2(net), cumulative: r2(cum) });
  }
  // Break-even, payback and ROI mean one thing across GT3 (lib/finance — the deal and the event say them the same way).
  const sustained = (f: (x: Month) => number) => breakEvenMonth(months.map(f));
  const recovered = (f: (x: Month) => number) => paybackMonth(months.map(f), startupSpend);
  const years = [1, 2, 3].map((y) => {
    const ms = months.filter((x) => Math.ceil(x.m / 12) === y);
    const s = (f: (x: Month) => number) => sum(ms.map(f));
    return { year: y, revenue: s((x) => x.revenue), cogs: s((x) => x.cogs), grossProfit: s((x) => x.grossProfit), operatingExpenses: s((x) => x.operatingExpenses),
      operating: s((x) => x.operating), toInvestor: s((x) => x.toInvestor), net: s((x) => x.net) };
  });
  const totOp = sum(months.map((x) => x.operating)), totNet = sum(months.map((x) => x.net)), rev = sum(months.map((x) => x.revenue));
  const reserveNeeded = r2(-lowest);
  return {
    ...empty, ok: true, missing: [], months, years, traffic: tr, capPerMonth: capPerMonth == null ? null : r2(capPerMonth),
    cappedMonths: months.filter((x) => x.ordersLost > 0).length, ordersLost: sum(months.map((x) => x.ordersLost)), salesLost: r2(sum(months.map((x) => x.ordersLost)) * aov), reserveNeeded, requiredFunding: startupSpend + reserveNeeded,
    breakEvenMonth: sustained((x) => x.operating), breakEvenAfterMonth: sustained((x) => x.net),
    paybackMonth: recovered((x) => x.operating), paybackAfterMonth: recovered((x) => x.net),
    roiBusiness: roi(totOp, startupSpend),
    roiAfter: roi(totNet, startupSpend),
    grossMarginPct: rev > 0 ? ((rev - sum(months.map((x) => x.cogs))) / rev) * 100 : null,
  };
}

/** A loan's level monthly payment (amortized): principal, an annual rate, months. 0% is the principal over the months. */
export function loanPayment(principal: number, aprPct: number, months: number): number {
  if (months <= 0) return 0;
  const i = aprPct / 100 / 12;
  return i === 0 ? principal / months : (principal * i) / (1 - Math.pow(1 + i, -months));
}

/** The annual rate that makes a monthly cash flow's present value zero (an IRR), or null when it has none — bisection,
 *  so it never runs away. flows[0] is month 0 (the investment, negative). */
export function irr(flows: number[]): number | null {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  const npv = (r: number) => flows.reduce((n, f, t) => n + f / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

/** The investor's side — from the structure as defined, never from an assumed exit. */
export type InvestorView = {
  kind: Structure["kind"]; amount: number; returned: number; multiple: number | null; irrPct: number | null;
  cashOnCashY1Pct: number | null; stillOwed: number | null; ownershipPct: number | null; says: string[];
};
export function investor(model: Model, s: Structure): InvestorView {
  if (s.kind === "none") return { kind: "none", amount: 0, returned: 0, multiple: null, irrPct: null, cashOnCashY1Pct: null, stillOwed: null, ownershipPct: null, says: ["No investment structure is set — the business's returns stand alone."] };
  const paid = model.months.map((x) => x.toInvestor);
  const returned = sum(paid), y1 = sum(paid.slice(0, 12));
  const says: string[] = [];
  let stillOwed: number | null = null, ownershipPct: number | null = null;
  const tail: number[] = [];
  const last = model.months[model.months.length - 1];
  if (s.kind === "loan") {
    const pmt = loanPayment(s.amountCents, s.aprPct, s.termMonths);
    stillOwed = s.termMonths > MONTHS ? r2(pmt * (s.termMonths - MONTHS)) : 0;
    says.push(`A loan: ${s.termMonths} monthly payments of ${dollars(pmt)} at ${s.aprPct}% a year.`);
    for (let m = MONTHS + 1; m <= Math.min(s.termMonths, 120); m++) tail.push(pmt);
  } else if (s.kind === "rev_share") {
    const cap = s.amountCents * s.capMultiple;
    stillOwed = r2(Math.max(0, cap - returned));
    says.push(`${s.sharePct}% of sales until ${dollars(cap)} (${s.capMultiple}× the investment) is paid.`);
    if (stillOwed > 0) says.push(`${dollars(stillOwed)} of the cap is still owed after 36 months.`);
    if (last) {
      let left = stillOwed;
      for (let m = MONTHS + 1; m <= 120 && left > 0; m++) { const p = Math.min(left, (last.revenue * s.sharePct) / 100); if (p <= 0) break; tail.push(p); left -= p; }
      if (tail.length) says.push(`Past month 36 the rate assumes sales hold at month 36's level: the cap is met in month ${MONTHS + tail.length}${left > 0 ? " — or not within ten years" : ""}.`);
    }
  } else if (s.kind === "equity") {
    ownershipPct = s.ownershipPct;
    says.push(`${s.ownershipPct}% ownership; ${s.payoutPct}% of each month's profit paid out to owners.`);
    if (s.payoutPct === 0) says.push("No payout is set: within 36 months the investor's return is ownership only — any cash return depends on a payout policy or a sale you'd define.");
    else says.push("The rate counts the 36 months' payouts only — what the ownership is worth after them depends on terms you'd set.");
  } else {
    says.push(`A SAFE: ${dollars(s.amountCents)} that becomes ownership at a later priced round — at most the cap (${dollars(s.capCents)}), or ${s.discountPct}% off that round's price.`);
    if (s.capCents > 0) { ownershipPct = (s.amountCents / s.capCents) * 100; says.push(`At the cap it would be about ${ownershipPct.toFixed(1)}% of the company (post-money). It pays no cash until then.`); }
  }
  if (model.months.some((x) => x.operating < x.toInvestor)) says.push(`In ${model.months.filter((x) => x.operating < x.toInvestor).length} of 36 months the payment is more than the business makes.`);
  const rate = s.kind === "safe" ? null : irr([-s.amountCents, ...paid, ...tail]);
  return {
    kind: s.kind, amount: s.amountCents, returned: r2(returned), multiple: s.amountCents > 0 && s.kind !== "safe" ? returned / s.amountCents : null,
    irrPct: rate == null ? null : rate * 100, cashOnCashY1Pct: s.amountCents > 0 && s.kind !== "safe" ? (y1 / s.amountCents) * 100 : null, stillOwed, ownershipPct, says,
  };
}

// ── the one dependency map ──────────────────────────────────────────────────────────────────────────────────────────
// Inputs (typed, or observed when taken from GT3's own sales) on the left; every computed figure names what it's made of.
export const INPUT_KEYS = ["uses", "demand", "channels", "room", "mix", "cogsPct", "cardFeePct", "labor", "rent", "otherOpex", "marketing", "structure", "ownerCash"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];
export const INPUT_WORD: Record<InputKey, string> = {
  uses: "What the money buys", demand: "Demand (orders a day, average order, days open, ramp, growth)", channels: "The traffic channels and guests coming back", room: "The room's counter (the cap on sales)", mix: "The product mix (prices, costs, packing, shares)", cogsPct: "Cost of goods %", cardFeePct: "Card fees %",
  labor: "Staff hours, wage and payroll costs", rent: "Rent", otherOpex: "Other costs a month", marketing: "Marketing a month", structure: "The investment structure", ownerCash: "The owners' own money",
};
export const METRICS = ["startupSpend", "reservePlanned", "revenue", "cogs", "grossProfit", "grossMargin", "operatingExpenses", "operatingCash", "investorPayments", "netCash",
  "reserveNeeded", "requiredFunding", "fundingRaised", "fundingGap", "breakEven", "breakEvenAfter", "payback", "paybackAfter", "roiBusiness", "roiAfter", "investorReturn", "ownership"] as const;
export type MetricKey = (typeof METRICS)[number];
export type NodeKey = InputKey | MetricKey;
export const DEPS: Record<MetricKey, NodeKey[]> = {
  startupSpend: ["uses"], reservePlanned: ["uses"],
  revenue: ["demand", "channels", "room", "mix"], cogs: ["revenue", "cogsPct", "mix"], grossProfit: ["revenue", "cogs"], grossMargin: ["grossProfit", "revenue"],
  operatingExpenses: ["revenue", "cardFeePct", "labor", "rent", "otherOpex", "marketing", "channels"], operatingCash: ["grossProfit", "operatingExpenses"],
  investorPayments: ["structure", "revenue", "operatingCash"], netCash: ["operatingCash", "investorPayments"],
  reserveNeeded: ["netCash"], requiredFunding: ["startupSpend", "reserveNeeded"], fundingRaised: ["structure", "ownerCash"], fundingGap: ["requiredFunding", "fundingRaised"],
  breakEven: ["operatingCash"], breakEvenAfter: ["netCash"], payback: ["startupSpend", "operatingCash"], paybackAfter: ["startupSpend", "netCash"],
  roiBusiness: ["startupSpend", "operatingCash"], roiAfter: ["startupSpend", "netCash"], investorReturn: ["structure", "investorPayments"], ownership: ["structure"],
};
/** What a node feeds directly. */
export const feeds = (k: NodeKey): MetricKey[] => METRICS.filter((m) => DEPS[m].includes(k));
/** Everything downstream of these nodes — what a change to them moves. */
export function downstream(keys: readonly NodeKey[]): Set<MetricKey> {
  const out = new Set<MetricKey>(), stack = [...keys];
  while (stack.length) for (const m of feeds(stack.pop()!)) if (!out.has(m)) { out.add(m); stack.push(m); }
  return out;
}
/** Everything a metric is built from, all the way back to the inputs. */
export function upstreamInputs(k: MetricKey): InputKey[] {
  const seen = new Set<NodeKey>(), stack: NodeKey[] = [k], out = new Set<InputKey>();
  while (stack.length) { const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); if ((INPUT_KEYS as readonly string[]).includes(n)) out.add(n as InputKey); else stack.push(...DEPS[n as MetricKey]); }
  return INPUT_KEYS.filter((x) => out.has(x));
}
/** Which inputs differ between two scenarios' numbers (and structures) — the "because" of a what-if. */
export function changedInputs(a: Inputs, b: Inputs, sa: Structure, sb: Structure, ca: Context = NO_ROOM, cb: Context = ca): InputKey[] {
  const pick: Record<InputKey, (i: Inputs) => unknown> = {
    uses: (i) => i.uses.map((l) => [l.category, l.qty, l.unitCents]), demand: (i) => [i.ordersPerDay, i.avgOrderCents, i.daysOpenPerMonth, i.rampMonths, i.rampStartPct, i.growthPctPerYear],
    channels: (i) => [i.demandFrom, i.demandFrom === "channels" ? [i.channels, i.repeatPerMonth, i.keptPct] : null],
    room: (i) => [i.capToRoom, i.capToRoom ? i.hoursOpenPerDay : null],
    mix: (i) => [i.mixDrives, i.mixDrives ? [i.mix, i.itemsPerOrder] : null],
    cogsPct: (i) => i.cogsPct, cardFeePct: (i) => i.cardFeePct, labor: (i) => [i.staffHoursPerDay, i.wageCents, i.laborBurdenPct], rent: (i) => [i.rentCents, i.rentPctOfSales],
    otherOpex: (i) => i.otherOpexCents, marketing: (i) => i.marketingCents, structure: () => null, ownerCash: (i) => i.ownerCashCents,
  };
  const out = INPUT_KEYS.filter((k) => k !== "structure" && JSON.stringify(pick[k](a)) !== JSON.stringify(pick[k](b)));
  if (!out.includes("room") && (a.capToRoom || b.capToRoom) && ca.counterPerHour !== cb.counterPerHour) out.push("room");
  if (JSON.stringify(sa) !== JSON.stringify(sb)) out.push("structure");
  return out;
}

// ── the traces ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type Kind = "assumed" | "observed" | "computed" | "simulated" | "actual";
export type Trace = {
  key: MetricKey; label: string; value: number | null; unit: "cents" | "pct" | "month" | "ratio";
  display: string; kind: Kind; says: string; formula: string; worked: string; period: string; madeOf: NodeKey[]; feeds: MetricKey[];
  /** A drill path, where the figure has one: each step a label and its value said. */
  path?: { label: string; value: string }[];
};
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const mon = (m: number | null) => (m == null ? "Not in 36 months" : `Month ${m}`);

/** Every figure of a model, traced. `observedInputs` names the inputs taken from GT3's own sales (their figures say so). */
export function trace(raw: Inputs, s: Structure, m: Model = project(raw, s), observedInputs: readonly InputKey[] = []): Record<MetricKey, Trace> {
  const i = effective(raw);
  const mx = raw.mixDrives ? mixOf(raw) : null;
  const mixRows = mx && !mx.problems.length ? raw.mix : null;
  const T = (key: MetricKey, label: string, value: number | null, unit: Trace["unit"], display: string, says: string, formula: string, worked: string, period: string, extra: Partial<Trace> = {}): Trace =>
    ({ key, label, value, unit, display, kind: "computed", says, formula, worked, period, madeOf: DEPS[key], feeds: feeds(key), ...extra });
  const tot = (f: (x: Month) => number) => sum(m.months.map(f));
  const spendLines = i.uses.filter((l) => l.category !== "reserve" && lineTotal(l) != null);
  const rev = tot((x) => x.revenue), cogs = tot((x) => x.cogs), gp = tot((x) => x.grossProfit), opx = tot((x) => x.operatingExpenses), op = tot((x) => x.operating), pay = tot((x) => x.toInvestor), net = tot((x) => x.net);
  const inv = investor(m, s);
  const ok = m.ok;
  const need = ok ? "" : `Set ${m.missing.join(", ")} first.`;
  const out: Record<MetricKey, Trace> = {
    startupSpend: T("startupSpend", "Startup spending", m.startupSpend, "cents", dollars(m.startupSpend),
      "What's spent before the doors open. The working-capital reserve isn't spending — it's held as cash — so it's not in this total.",
      "Σ (quantity × unit cost) over every priced line except the reserve",
      spendLines.length ? `${spendLines.map((l) => dollars(lineTotal(l)!)).join(" + ")} = ${dollars(m.startupSpend)}${m.unpriced ? ` · ${m.unpriced} line${m.unpriced === 1 ? "" : "s"} not priced yet, not counted` : ""}` : "No priced lines yet.",
      "Before opening"),
    reservePlanned: T("reservePlanned", "Working-capital reserve", m.reservePlanned, "cents", dollars(m.reservePlanned),
      "Cash held at opening to carry the early months. Drawn down by losses and early investor payments; never counted as spent.",
      "Σ (quantity × unit cost) over the reserve lines", `${dollars(m.reservePlanned)} planned · ${ok ? `${dollars(m.reserveNeeded)} needed by the months` : need}`, "At opening"),
    revenue: T("revenue", "Sales, 36 months", ok ? rev : null, "cents", ok ? dollars(rev) : "—",
      `Orders × the average order, month by month — ${m.demandFrom === "channels" ? "the orders the traffic channels bring (new guests and the ones who come back)" : "the ramp to full stride, then growth each year"}${m.capPerMonth != null ? ", capped at what the room's counter can take" : ""}.`,
      m.demandFrom === "channels" ? `Σ (the channels' orders that month${m.capPerMonth != null ? ", at most the counter's" : ""}) × average order, months 1–36`
        : `orders a day × ramp × growth × days open${m.capPerMonth != null ? ", at most the counter's," : ""} × average order, summed over months 1–36`,
      ok ? `month 1: ${m.months[0].orders.toLocaleString("en-US")} orders × ${dollars(i.avgOrderCents!)} = ${dollars(m.months[0].revenue)} · year 1 ${dollars(m.years[0].revenue)} · 36 months ${dollars(rev)}${m.ordersLost > 0 ? ` · ${Math.round(m.ordersLost).toLocaleString("en-US")} orders (${dollars(m.salesLost)}) past the counter, not counted` : ""}` : need,
      "Months 1–36", { kind: m.capPerMonth != null || m.demandFrom === "channels" ? "simulated" : "computed", path: ok ? [
        ...(m.demandFrom === "channels" && m.traffic ? [
          { label: "Demand from", value: "The traffic channels, live" },
          { label: "Reach, month 12", value: `${Math.round(i.channels.reduce((n, c) => n + (12 >= (c.startMonth || 1) ? c.reach : 0), 0)).toLocaleString("en-US")} people` },
          { label: "First orders, month 12", value: (Math.round(m.traffic.months[11].newGuests * 10) / 10).toLocaleString("en-US") },
          { label: "Guests coming back, month 12", value: (Math.round(m.traffic.months[11].returning * 10) / 10).toLocaleString("en-US") },
        ] : [
          { label: "Orders a day at full stride", value: String(i.ordersPerDay) }, { label: "Days open a month", value: String(i.daysOpenPerMonth) },
          { label: "Ramp", value: i.rampMonths ? `${i.rampStartPct}% → 100% over ${i.rampMonths} months` : "Full from month 1" }, { label: "Growth after the ramp", value: `${i.growthPctPerYear}% a year` },
        ]),
        ...(m.capPerMonth != null ? [{ label: "The room's counter takes", value: `${Math.round(m.capPerMonth).toLocaleString("en-US")} orders a month — capped in ${m.cappedMonths} of 36` }] : []),
        { label: "Transactions, 36 months", value: Math.round(tot((x) => x.orders)).toLocaleString("en-US") }, { label: "Average order", value: dollars(i.avgOrderCents!) },
        ...(mixRows ? mixRows.map((l) => ({ label: `${l.label} · ${l.sharePct}% of items`, value: dollars(l.priceCents!) })) : [{ label: "Product mix", value: "Not set — the typed average order stands for the mix" }])] : undefined }),
    cogs: T("cogs", "Cost of goods, 36 months", ok ? cogs : null, "cents", ok ? dollars(cogs) : "—",
      "Ingredients, packaging and other direct costs of what's sold — one percentage of sales until a product mix is modelled.",
      "sales × cost of goods %", ok ? `${dollars(rev)} × ${pct(i.cogsPct, 1)} = ${dollars(cogs)}` : need, "Months 1–36"),
    grossProfit: T("grossProfit", "Gross profit, 36 months", ok ? gp : null, "cents", ok ? dollars(gp) : "—",
      "What's left of sales after the cost of goods.", "sales − cost of goods", ok ? `${dollars(rev)} − ${dollars(cogs)} = ${dollars(gp)}` : need, "Months 1–36"),
    grossMargin: T("grossMargin", "Gross margin", m.grossMarginPct, "pct", pct(m.grossMarginPct),
      "Gross profit as a share of sales. Card fees are an operating expense, below this line.", "gross profit ÷ sales",
      ok ? `${dollars(gp)} ÷ ${dollars(rev)} = ${pct(m.grossMarginPct)}` : need, "Months 1–36",
      { path: ok ? [{ label: "Sales", value: dollars(rev) },
        ...(mixRows ? mixRows.map((l) => ({ label: `${l.label} (${l.sharePct}%)`, value: `${dollars(l.priceCents!)} · ingredients ${dollars(l.unitCostCents!)} · packing ${dollars(l.packagingCents ?? 0)} · ${l.priceCents ? pct(((l.priceCents - l.unitCostCents! - (l.packagingCents ?? 0)) / l.priceCents) * 100, 0) : "—"} margin` })) : []),
        { label: mixRows ? "Cost of goods, from the mix" : "Cost of goods (ingredients, packaging, direct — one typed %)", value: `${dollars(cogs)} (${pct(i.cogsPct, 1)})` }, { label: "Gross profit", value: dollars(gp) }, { label: "Gross margin", value: pct(m.grossMarginPct) }] : undefined }),
    operatingExpenses: T("operatingExpenses", "Operating expenses, 36 months", ok ? opx : null, "cents", ok ? dollars(opx) : "—",
      "Card fees, staff, rent, other costs and marketing.", "card fees + labor + rent + other + marketing, each month",
      ok ? `month 1: ${dollars(m.months[0].fees)} fees + ${dollars(m.months[0].labor)} labor + ${dollars(m.months[0].rent)} rent + ${dollars(i.otherOpexCents)} other + ${dollars(i.marketingCents)} marketing = ${dollars(m.months[0].operatingExpenses)}` : need, "Months 1–36"),
    operatingCash: T("operatingCash", "Operating cash, 36 months", ok ? op : null, "cents", ok ? dollars(op) : "—",
      "What the business makes before paying its investor: gross profit less operating expenses. Before tax, depreciation and owners' pay.",
      "gross profit − operating expenses, each month", ok ? `${dollars(gp)} − ${dollars(opx)} = ${dollars(op)}` : need, "Months 1–36"),
    investorPayments: T("investorPayments", "Paid to the investor, 36 months", ok ? pay : null, "cents", ok ? dollars(pay) : "—",
      "What the structure pays out, month by month.", s.kind === "loan" ? "the amortized payment each month of the term" : s.kind === "rev_share" ? "share % × sales each month, until the cap" : s.kind === "equity" ? "ownership % × payout % × the month's operating profit" : "nothing paid in cash",
      ok ? `${dollars(pay)} over 36 months` : need, "Months 1–36"),
    netCash: T("netCash", "Net cash, 36 months", ok ? net : null, "cents", ok ? dollars(net) : "—",
      "Operating cash after the investor is paid.", "operating cash − investor payments", ok ? `${dollars(op)} − ${dollars(pay)} = ${dollars(net)}` : need, "Months 1–36"),
    reserveNeeded: T("reserveNeeded", "Cash the early months need", ok ? m.reserveNeeded : null, "cents", ok ? dollars(m.reserveNeeded) : "—",
      "The deepest the running net cash goes below zero — the losses and investor payments before the business carries itself.",
      "− (lowest running total of net cash, months 1–36), or 0", ok ? `lowest running total ${dollars(-m.reserveNeeded)} → ${dollars(m.reserveNeeded)}` : need, "Months 1–36"),
    requiredFunding: T("requiredFunding", "Funding required", ok ? m.requiredFunding : null, "cents", ok ? dollars(m.requiredFunding) : "—",
      "What must be raised so cash never goes below zero: the startup spending and the cash the early months need, investor payments counted.",
      "startup spending + cash the early months need", ok ? `${dollars(m.startupSpend)} + ${dollars(m.reserveNeeded)} = ${dollars(m.requiredFunding)}` : need, "Before opening, through month 36"),
    fundingRaised: T("fundingRaised", "Funding raised", m.fundingRaised, "cents", dollars(m.fundingRaised),
      "The investor's money and the owners' own.", "investment amount + owners' cash", `${dollars(s.kind === "none" ? 0 : s.amountCents)} + ${dollars(i.ownerCashCents)} = ${dollars(m.fundingRaised)}`, "At opening"),
    fundingGap: T("fundingGap", ok && m.fundingRaised < m.requiredFunding ? "Funding short" : "Funding to spare", ok ? m.fundingRaised - m.requiredFunding : null, "cents", ok ? dollars(m.fundingRaised - m.requiredFunding) : "—",
      "Raised against required: short is cash that would run out; to spare is cash left at the low point.", "funding raised − funding required",
      ok ? `${dollars(m.fundingRaised)} − ${dollars(m.requiredFunding)} = ${dollars(m.fundingRaised - m.requiredFunding)}` : need, "At the low point"),
    breakEven: T("breakEven", "Break-even (before the investor)", m.breakEvenMonth, "month", ok ? mon(m.breakEvenMonth) : "—",
      "The first month from which operating cash stays at or above zero through month 36.", "first month m with operating cash ≥ 0 for every month m…36",
      ok ? (m.breakEvenMonth ? `month ${m.breakEvenMonth}: ${dollars(m.months[m.breakEvenMonth - 1].operating)}${m.breakEvenMonth > 1 ? ` (month ${m.breakEvenMonth - 1}: ${dollars(m.months[m.breakEvenMonth - 2].operating)})` : ""}` : "month 36 is still negative") : need, "Months 1–36"),
    breakEvenAfter: T("breakEvenAfter", "Break-even (after the investor)", m.breakEvenAfterMonth, "month", ok ? mon(m.breakEvenAfterMonth) : "—",
      "The same, after the investor's payments.", "first month m with net cash ≥ 0 for every month m…36", ok ? mon(m.breakEvenAfterMonth) : need, "Months 1–36"),
    payback: T("payback", "Payback (before the investor)", m.paybackMonth, "month", ok ? (m.startupSpend > 0 ? mon(m.paybackMonth) : "Nothing to earn back") : "—",
      "The month operating cash has earned back the startup spending.", "first month where Σ operating cash ≥ startup spending",
      ok ? (m.paybackMonth ? `by month ${m.paybackMonth}: ${dollars(sum(m.months.slice(0, m.paybackMonth).map((x) => x.operating)))} ≥ ${dollars(m.startupSpend)}` : `36 months earn ${dollars(op)} of ${dollars(m.startupSpend)}`) : need, "Months 1–36"),
    paybackAfter: T("paybackAfter", "Payback (after the investor)", m.paybackAfterMonth, "month", ok ? (m.startupSpend > 0 ? mon(m.paybackAfterMonth) : "Nothing to earn back") : "—",
      "The month net cash has earned back the startup spending.", "first month where Σ net cash ≥ startup spending", ok ? mon(m.paybackAfterMonth) : need, "Months 1–36"),
    roiBusiness: T("roiBusiness", "Business ROI, 36 months", m.roiBusiness == null ? null : m.roiBusiness * 100, "pct", m.roiBusiness == null ? "—" : pct(m.roiBusiness * 100, 0),
      "Business-level, before financing and before tax: 36 months' operating cash against the startup spending. Not the investor's return, and no value counted for the business after month 36.",
      "(Σ operating cash − startup spending) ÷ startup spending", ok && m.startupSpend > 0 ? `(${dollars(op)} − ${dollars(m.startupSpend)}) ÷ ${dollars(m.startupSpend)} = ${pct(m.roiBusiness! * 100, 0)}` : ok ? "No startup spending to measure against." : need, "Months 1–36",
      { path: ok ? [{ label: "Investment basis", value: `${dollars(m.startupSpend)} startup spending` }, { label: "Cash flows", value: `${dollars(op)} operating cash, months 1–36` }, { label: "Return", value: dollars(op - m.startupSpend) }, { label: "Horizon", value: "36 months, before financing and tax" }, { label: "Result", value: m.roiBusiness == null ? "—" : pct(m.roiBusiness * 100, 0) }] : undefined }),
    roiAfter: T("roiAfter", "ROI after the investor, 36 months", m.roiAfter == null ? null : m.roiAfter * 100, "pct", m.roiAfter == null ? "—" : pct(m.roiAfter * 100, 0),
      "The business's return once the investor is paid — what's left for the owners, before tax.", "(Σ net cash − startup spending) ÷ startup spending",
      ok && m.startupSpend > 0 ? `(${dollars(net)} − ${dollars(m.startupSpend)}) ÷ ${dollars(m.startupSpend)} = ${pct(m.roiAfter! * 100, 0)}` : ok ? "No startup spending to measure against." : need, "Months 1–36"),
    investorReturn: T("investorReturn", "The investor's return", inv.irrPct, "pct", inv.irrPct == null ? (s.kind === "safe" ? "Converts later" : "—") : `${inv.irrPct.toFixed(1)}% a year`,
      "The investor's rate of return (IRR) under the structure as defined — over its whole term, past month 36 where the contract runs on.", "the annual rate at which the investment equals the present value of the payments",
      inv.says.join(" "), s.kind === "loan" ? `${s.termMonths} months` : "Months 1–36 and the contract's remainder"),
    ownership: T("ownership", "The investor's ownership", inv.ownershipPct, "pct", inv.ownershipPct == null ? "None in this structure" : pct(inv.ownershipPct),
      "What the structure implies the investor owns. There's no cap table in GT3 yet, so nothing is assumed about other owners or later rounds.",
      s.kind === "safe" ? "SAFE amount ÷ valuation cap (post-money)" : s.kind === "equity" ? "the ownership % agreed" : "—", inv.says[0] ?? "", "At conversion / at investment"),
  };
  for (const k of observedInputs) for (const t of Object.values(out)) { const up = upstreamInputs(t.key); if (up.length === 1 && up[0] === k) t.kind = "observed"; }
  return out;
}

/** A what-if against a baseline: every figure that moved, before → after, and the inputs that moved it. */
export type Change = { key: MetricKey; label: string; before: string; after: string; delta: number | null; because: InputKey[] };
export function compare(base: Record<MetricKey, Trace>, now: Record<MetricKey, Trace>, inputsChanged: readonly InputKey[]): Change[] {
  return METRICS.filter((k) => base[k].display !== now[k].display || base[k].value !== now[k].value)
    .map((k) => ({ key: k, label: now[k].label, before: base[k].display, after: now[k].display,
      delta: base[k].value != null && now[k].value != null ? now[k].value! - base[k].value! : null,
      because: inputsChanged.filter((x) => upstreamInputs(k).includes(x)) }));
}

/** What moves the result most: each driver up and down by `pctMove`, the change in 36 months' operating cash less startup. */
export type Swing = { driver: string; down: number; up: number; span: number };
export function sensitivity(raw: Inputs, pctMove = 20, ctx: Context = NO_ROOM): Swing[] {
  // With the mix driving, swing the average order and the cost of goods it works out to — the same numbers, held still.
  const i = raw.mixDrives ? { ...effective(raw), mixDrives: false } : raw;
  if (!project(i, { kind: "none" }, ctx).ok) return [];
  const total = (x: Inputs) => { const m = project(x, { kind: "none" }, ctx); return sum(m.months.map((mo) => mo.operating)) - m.startupSpend; };
  const b = total(i);
  type D = { word: string; on: boolean; at: (f: number) => Inputs };
  const scaleLines = (f: number): Inputs => ({ ...i, uses: i.uses.map((l) => (l.category === "reserve" || l.unitCents == null ? l : { ...l, unitCents: l.unitCents * f })) });
  const D: D[] = [
    { word: "Orders a day", on: i.demandFrom === "typed" && (i.ordersPerDay ?? 0) > 0, at: (f) => ({ ...i, ordersPerDay: i.ordersPerDay! * f }) },
    { word: "The channels' reach", on: i.demandFrom === "channels" && i.channels.some((c) => c.reach > 0), at: (f) => ({ ...i, channels: i.channels.map((c) => ({ ...c, reach: c.reach * f })) }) },
    { word: "Average order", on: (i.avgOrderCents ?? 0) > 0, at: (f) => ({ ...i, avgOrderCents: i.avgOrderCents! * f }) },
    { word: "Cost of goods", on: (i.cogsPct ?? 0) > 0, at: (f) => ({ ...i, cogsPct: i.cogsPct! * f }) },
    { word: "Wage", on: (i.wageCents ?? 0) > 0, at: (f) => ({ ...i, wageCents: i.wageCents! * f }) },
    { word: "Staff hours", on: (i.staffHoursPerDay ?? 0) > 0, at: (f) => ({ ...i, staffHoursPerDay: i.staffHoursPerDay! * f }) },
    { word: "Rent", on: i.rentCents > 0, at: (f) => ({ ...i, rentCents: i.rentCents * f }) },
    { word: "Startup spending", on: i.uses.some((l) => l.category !== "reserve" && l.unitCents != null), at: scaleLines },
  ];
  return D.filter((d) => d.on).map((d) => { const down = total(d.at(1 - pctMove / 100)) - b, up = total(d.at(1 + pctMove / 100)) - b; return { driver: d.word, down: r2(down), up: r2(up), span: Math.abs(up - down) }; })
    .sort((a, c) => c.span - a.span);
}

/** Where the model disagrees with itself — arithmetic on Ryan's own numbers, never a benchmark. */
export type Flag = { level: "stop" | "look"; words: string; about: MetricKey | null };
export function flags(i: Inputs, model: Model, s: Structure, askedCents: number | null = null, others?: Partial<Record<Scenario, Model>>): Flag[] {
  if (!model.ok) return [{ level: "look", words: `Set ${model.missing.join(", ")} to see the money.`, about: null }];
  const out: Flag[] = [];
  if ((i.cogsPct ?? 0) + i.cardFeePct >= 100) out.push({ level: "stop", words: "Cost of goods and card fees take every dollar of sales — nothing is left to pay for anything else.", about: "grossMargin" });
  if (i.hoursOpenPerDay != null && i.staffHoursPerDay != null && i.staffHoursPerDay < i.hoursOpenPerDay)
    out.push({ level: "stop", words: `Open ${i.hoursOpenPerDay} hours a day with ${i.staffHoursPerDay} staff hours — nobody's there for ${i.hoursOpenPerDay - i.staffHoursPerDay} of them.`, about: "operatingExpenses" });
  if (!i.uses.length) out.push({ level: "look", words: "No startup lines — what does the money buy? List them.", about: "startupSpend" });
  if (model.unpriced) out.push({ level: "look", words: `${model.unpriced} startup line${model.unpriced === 1 ? " isn't" : "s aren't"} priced yet — the totals leave ${model.unpriced === 1 ? "it" : "them"} out.`, about: "startupSpend" });
  if (model.breakEvenMonth == null) out.push({ level: "stop", words: "It doesn't break even within 36 months on these numbers.", about: "breakEven" });
  else if (model.paybackMonth == null && model.startupSpend > 0) out.push({ level: "look", words: "It breaks even, but doesn't earn back its startup spending within 36 months.", about: "payback" });
  if (model.fundingRaised > 0 && model.fundingRaised < model.requiredFunding)
    out.push({ level: "stop", words: `Short by ${dollars(model.requiredFunding - model.fundingRaised)}: ${dollars(model.requiredFunding)} is required (${dollars(model.startupSpend)} to open + ${dollars(model.reserveNeeded)} for the early months) and ${dollars(model.fundingRaised)} is raised.`, about: "fundingGap" });
  else if (model.fundingRaised === 0 && model.requiredFunding > 0) out.push({ level: "look", words: `${dollars(model.requiredFunding)} is required, and no funding is set against it yet.`, about: "requiredFunding" });
  if (model.reservePlanned > 0 && model.reservePlanned < model.reserveNeeded) out.push({ level: "look", words: `The reserve planned (${dollars(model.reservePlanned)}) is less than the early months need (${dollars(model.reserveNeeded)}).`, about: "reserveNeeded" });
  if (askedCents != null && askedCents > 0 && Math.abs(askedCents - model.requiredFunding) > 100) out.push({ level: "look", words: `The roadmap asks for ${dollars(askedCents)} for this plan; the money says ${dollars(model.requiredFunding)} is required.`, about: "requiredFunding" });
  if (model.ordersLost > 0) out.push({ level: "look", words: `The room's counter caps sales in ${model.cappedMonths} of 36 months: ${Math.round(model.ordersLost).toLocaleString("en-US")} orders (${dollars(model.salesLost)}) the plan asks for and the counter can't take. Another register or a faster order would carry them.`, about: "revenue" });
  const pays = model.months.filter((x) => x.operating < x.toInvestor).length;
  if (s.kind !== "none" && pays > 0) out.push({ level: "look", words: `The investor's payment is more than the business makes in ${pays} of 36 months — the reserve covers it.`, about: "investorPayments" });
  if (others?.conservative?.ok && others?.upside?.ok) {
    const tot = (m: Model) => sum(m.months.map((x) => x.operating));
    if (tot(others.conservative) > tot(model) || tot(others.upside) < tot(model)) out.push({ level: "look", words: "The scenarios are out of order: Conservative should make the least and Upside the most.", about: null });
  }
  return out;
}


/** A scenario made from another — demand and the average order moved by `demandPct`, costs by `costPct` — starting points
 *  to edit. Ryan's base, moved by his percentages; nothing new is introduced. */
export function derive(base: Inputs, demandPct: number, costPct: number): Inputs {
  const d = 1 + demandPct / 100, c = 1 + costPct / 100;
  const n = (v: number | null, f: number) => (v == null ? null : Math.round(v * f * 100) / 100);
  return {
    ...base,
    uses: base.uses.map((l) => (l.category === "reserve" || l.unitCents == null ? { ...l } : { ...l, unitCents: Math.round(l.unitCents * c) })),
    ordersPerDay: n(base.ordersPerDay, d), avgOrderCents: base.avgOrderCents == null ? null : Math.round(base.avgOrderCents * (1 + demandPct / 200)),
    cogsPct: n(base.cogsPct, c), wageCents: base.wageCents == null ? null : Math.round(base.wageCents * c),
    rentCents: Math.round(base.rentCents * c), otherOpexCents: Math.round(base.otherOpexCents * c),
  };
}

/** What GT3's own sales say (lib/orderLedger lines) — evidence, not assumption: paid orders, not canceled, by channel. */
export type Observed = { channel: string; orders: number; avgOrderCents: number | null; activeDays: number; ordersPerActiveDay: number | null; repeatPct: number | null; from: string | null; through: string | null };
export function observed(lines: readonly { channel: string; day: string; totalCents: number; isPaid: boolean; canceled: boolean; customerId: string | null }[]): Observed[] {
  const ok = lines.filter((l) => l.isPaid && !l.canceled && l.totalCents > 0);
  const one = (channel: string, ls: typeof ok): Observed => {
    const days = new Set(ls.map((l) => l.day));
    const who = new Map<string, number>();
    for (const l of ls) if (l.customerId) who.set(l.customerId, (who.get(l.customerId) ?? 0) + 1);
    const sorted = [...days].sort();
    return {
      channel, orders: ls.length, avgOrderCents: ls.length ? Math.round(sum(ls.map((l) => l.totalCents)) / ls.length) : null,
      activeDays: days.size, ordersPerActiveDay: days.size ? Math.round((ls.length / days.size) * 10) / 10 : null,
      repeatPct: who.size ? Math.round(([...who.values()].filter((n) => n >= 2).length / who.size) * 1000) / 10 : null,
      from: sorted[0] ?? null, through: sorted[sorted.length - 1] ?? null,
    };
  };
  const chans = [...new Set(ok.map((l) => l.channel))].sort();
  return [one("all", ok), ...chans.map((c) => one(c, ok.filter((l) => l.channel === c)))];
}
