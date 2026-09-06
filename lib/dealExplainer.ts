// DEAL EXPLAINER — the same numbers, from the signer's side of the table.
//
// lib/operatorDeal.ts computes the split and the projection. That is the OWNER's view: build a
// proposal, see what it costs. This module answers the questions the person being offered the deal
// actually has, and it is a separate file because the honesty rules are different.
//
// THE RULE THIS MODULE HOLDS: every function here must be as willing to produce a bad number as a
// good one. A slider that only moves up is a sales tool. The single most useful output below is
// breakeven — the revenue an operator has to clear before they earn a dollar — precisely because it
// is the number a proposal never volunteers.
//
// Pure and deterministic, same contract as the modules it builds on, so it is unit-tested in
// scripts/smoke.cjs rather than trusted.

import {
  type DealTerms, type Stage, type Tier, TIER, TIERS, nextTier,
  computeSplit, project, MARKET_REINVEST_PCT,
} from "./operatorDeal";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cents = (n: number) => Math.max(0, Math.round(Number(n) || 0));

// ── where the money goes, said plainly ───────────────────────────────────────────────────────────
export interface ShareLine {
  key: "operator" | "royalty" | "market";
  pct: number;
  who: string;
  means: string;
}

/** One honest sentence per share, written to the person signing rather than about them. */
export function plainSplit(terms: DealTerms): ShareLine[] {
  const s = computeSplit(terms);
  const ramp = terms.stage === "ramp";
  return [
    { key: "operator", pct: s.operatorPct, who: "You",
      means: "Your share of what the market takes in, before you pay for whatever supplies you fund." },
    { key: "royalty", pct: s.royaltyPct, who: "GT3",
      means: ramp
        ? "Nothing, while the market is still ramping. Royalty starts when the market is profitable, not before."
        : "The royalty, for the brand, the recipes, the app and the support behind you." },
    { key: "market", pct: s.marketPct, who: "Your market",
      means: `Held back and reinvested in your own city — equipment, stock, hiring. This ${MARKET_REINVEST_PCT}% does not move no matter where the slider sits, by design: a market that stops reinvesting stops growing.` },
  ];
}

// ── the number a proposal never volunteers ───────────────────────────────────────────────────────
/**
 * Revenue at which the operator's NET reaches zero, for a supply bill they have already committed
 * to. Below this they are paying to work. Returns null when they fund nothing — there is no
 * breakeven to clear if none of the cost is theirs.
 */
export function breakevenRevenueCents(terms: DealTerms, suppliesCents: number): number | null {
  const sup = cents(suppliesCents);
  const funding = clamp(Number(terms.supplyFunding) || 0, 0, 100);
  const opPct = computeSplit(terms).operatorPct;
  const theirSupplies = sup * (funding / 100);
  if (theirSupplies <= 0) return null;
  if (opPct <= 0) return Infinity;
  return Math.round(theirSupplies / (opPct / 100));
}

/**
 * When supplies scale WITH revenue (which is how they actually behave), there is no breakeven
 * revenue — there is a margin per dollar that is either positive or negative. This is that margin,
 * in cents earned per dollar of revenue, and it can be negative.
 */
export function netPerDollarCents(terms: DealTerms, cogsPctOfRevenue: number): number {
  const cogs = clamp(Number(cogsPctOfRevenue) || 0, 0, 100) / 100;
  const funding = clamp(Number(terms.supplyFunding) || 0, 0, 100) / 100;
  const opPct = computeSplit(terms).operatorPct / 100;
  return Math.round((opPct - funding * cogs) * 100);
}

/**
 * The highest supply-funding position at which the operator still earns something per dollar.
 * Scanned rather than solved, because operatorPct itself moves with funding. Returns 100 when every
 * position is still positive — which is the answer when supplies are cheap relative to the share.
 */
export function fundingCeiling(terms: DealTerms, cogsPctOfRevenue: number): number {
  let ceiling = 0;
  for (let f = 0; f <= 100; f += 1) {
    if (netPerDollarCents({ ...terms, supplyFunding: f }, cogsPctOfRevenue) > 0) ceiling = f;
  }
  return ceiling;
}

// ── the trade, at both ends and in between ───────────────────────────────────────────────────────
export interface LadderStep {
  funding: number;
  operatorPct: number;
  netCents: number;
  /** true for the position that pays the operator most at these numbers */
  best: boolean;
}

/**
 * The whole slider at a glance: what each funding position pays THEM. The best position is marked,
 * and it is frequently not the end — which is the point of showing it.
 */
export function fundingLadder(
  terms: DealTerms, revenueCents: number, suppliesCents: number, step = 10,
): LadderStep[] {
  const st = clamp(Math.round(step) || 10, 1, 50);
  const out: LadderStep[] = [];
  let bestNet = -Infinity, bestF = 0;
  for (let f = 0; f <= 100; f += st) {
    const p = project({ ...terms, supplyFunding: f }, revenueCents, suppliesCents);
    out.push({ funding: f, operatorPct: p.split.operatorPct, netCents: p.operatorNetCents, best: false });
    if (p.operatorNetCents > bestNet) { bestNet = p.operatorNetCents; bestF = f; }
  }
  for (const s of out) if (s.funding === bestF) s.best = true;
  return out;
}

/** Plain reading of where they sit versus where they'd be best off. Says "worse" when it is worse. */
export function fundingVerdict(terms: DealTerms, revenueCents: number, suppliesCents: number): string {
  const here = project(terms, revenueCents, suppliesCents).operatorNetCents;
  const ladder = fundingLadder(terms, revenueCents, suppliesCents, 5);
  const best = ladder.find((s) => s.best);
  if (!best) return "Not enough to go on yet.";
  if (here <= 0) {
    return "At these numbers this position pays you nothing. Funding less of the supplies is worth asking for.";
  }
  const gap = best.netCents - here;
  if (gap <= 0) return "At these numbers, this is the position on the slider that pays you the most.";
  const pct = Math.round((gap / Math.max(1, Math.abs(here))) * 100);
  return `At these numbers you'd take home about ${pct}% more at ${best.funding}% supply funding. Worth raising before you sign.`;
}

// ── who put what in, and when each side gets it back ─────────────────────────────────────────────
//
// THE RELATIONSHIP THIS MAKES VISIBLE: the more GT3 capitalises a market, the smaller the operator's
// share and the longer their own money takes to come back. That is not a trick in the deal, it is
// the deal — capital carries risk and risk is what the share is paying for. But it is invisible in a
// percentage, and a person deciding how much to put in deserves to see it in months.
//
// Every number here assumes revenue holds steady, which it will not. It is an illustration for
// comparing two positions against each other, not a forecast, and the UI says so.

export interface Payback {
  /** what this side put in up front, in cents */
  contributionCents: number;
  /** what they take out each month at the modelled revenue */
  monthlyCents: number;
  /** months to get the contribution back; null when they put nothing in, Infinity when nothing comes back */
  months: number | null;
}

export function paybackMonths(contributionCents: number, monthlyCents: number): number | null {
  const c = cents(contributionCents);
  if (c <= 0) return null;
  const m = Math.round(Number(monthlyCents) || 0);
  if (m <= 0) return Infinity;
  return Math.ceil(c / m);
}

export interface InvestmentPicture {
  operator: Payback;
  gt3: Payback;
  /** the same position with GT3 funding ALL supplies — the "owner puts in more" end */
  ifGt3FundedAll: { operatorPct: number; operatorMonthlyCents: number; operatorMonths: number | null };
  /** the same position with the OPERATOR funding all supplies — the other end */
  ifOperatorFundedAll: { operatorPct: number; operatorMonthlyCents: number; operatorMonths: number | null };
  /** one sentence naming the trade in the direction it actually runs */
  tradeoff: string;
}

export function investmentPicture(o: {
  terms: DealTerms;
  monthlyRevenueCents: number;
  monthlySuppliesCents: number;
  gt3ContributionCents: number;
  operatorContributionCents: number;
}): InvestmentPicture {
  const rev = cents(o.monthlyRevenueCents);
  const sup = cents(o.monthlySuppliesCents);

  const at = (funding: number) => {
    const p = project({ ...o.terms, supplyFunding: funding }, rev, sup);
    return { operatorPct: p.split.operatorPct, monthly: p.operatorNetCents, royalty: p.royaltyCents };
  };

  const here = at(clamp(Number(o.terms.supplyFunding) || 0, 0, 100));
  const low = at(0);    // GT3 funds everything — the owner puts in most
  const high = at(100); // the operator funds everything

  const opContribution = cents(o.operatorContributionCents);
  const gt3Contribution = cents(o.gt3ContributionCents);

  const monthsAt = (monthly: number) => paybackMonths(opContribution, monthly);

  const lowMonths = monthsAt(low.monthly);
  const highMonths = monthsAt(high.monthly);

  let tradeoff: string;
  if (opContribution <= 0) {
    tradeoff = `You are putting in no capital, so there is nothing for you to earn back. The cost is the share: ${low.operatorPct}% instead of ${high.operatorPct}%.`;
  } else if (lowMonths === Infinity || highMonths === Infinity) {
    tradeoff = "At this revenue one of these positions never pays your capital back. Raise the revenue assumption or fund less.";
  } else if (typeof lowMonths === "number" && typeof highMonths === "number") {
    tradeoff = `The more GT3 funds, the smaller your share and the longer your own money takes to come back: about ${lowMonths} months if GT3 funds everything, about ${highMonths} if you do. Less risk, slower return — that is the whole trade.`;
  } else {
    tradeoff = "Not enough entered yet to compare the two ends.";
  }

  return {
    operator: { contributionCents: opContribution, monthlyCents: here.monthly, months: paybackMonths(opContribution, here.monthly) },
    gt3: { contributionCents: gt3Contribution, monthlyCents: here.royalty, months: paybackMonths(gt3Contribution, here.royalty) },
    ifGt3FundedAll: { operatorPct: low.operatorPct, operatorMonthlyCents: low.monthly, operatorMonths: lowMonths },
    ifOperatorFundedAll: { operatorPct: high.operatorPct, operatorMonthlyCents: high.monthly, operatorMonths: highMonths },
    tradeoff,
  };
}

// ── where this sits on the ladder ────────────────────────────────────────────────────────────────
export interface TierStep { tier: Tier; label: string; uplift: number; advance: string; current: boolean; reached: boolean }

/** The whole progression, with where they are now — so the deal reads as a position, not a ceiling. */
export function tierLadder(current: Tier): TierStep[] {
  const i = TIERS.indexOf(current);
  return TIERS.map((t, n) => ({
    tier: t, label: TIER[t].label, uplift: TIER[t].uplift, advance: TIER[t].advance,
    current: t === current, reached: n <= i,
  }));
}

export const whatIsNext = (current: Tier): string => {
  const n = nextTier(current);
  return n ? `${TIER[n].label} — ${TIER[current].advance}` : TIER[current].advance;
};

// ── what signing actually does ───────────────────────────────────────────────────────────────────
export interface SigningFact { k: string; v: string; heavy?: boolean }

/**
 * The consequences of accepting, in the order they matter. `heavy` marks the ones that cannot be
 * undone by changing your mind later — those are the ones a person should read twice.
 */
export function whatYouAreSigning(o: {
  stage?: Stage; supplySourcing?: string; priceBasis?: string | null;
  equityEligible?: boolean; equityScope?: string;
}): SigningFact[] {
  const f: SigningFact[] = [];
  f.push({ k: "The numbers become final", heavy: true,
    v: "Once you accept, the split, the supply terms and the tier are locked. Changing any of them means ending this agreement and drafting a new one — nobody can quietly edit it afterwards, including GT3." });
  f.push({ k: "Royalty timing",
    v: o.stage === "ramp"
      ? "No royalty is taken while the market is ramping. It begins when the market is profitable."
      : "The market is treated as profitable, so royalty applies from the start." });

  switch (o.supplySourcing) {
    case "operator_local":
      f.push({ k: "You buy your own supplies",
        v: "You choose your vendors and pay their prices. GT3 may specify a brand or a standard, but does not sell it to you." }); break;
    case "gt3_supplied":
      f.push({ k: "GT3 supplies you", heavy: true,
        v: o.priceBasis === "cost_plus"
          ? "GT3 buys and ships your supplies and charges you a markup on them. That markup is a real cost on top of the split — ask what it is in dollars before you sign."
          : "GT3 buys and ships your supplies at cost. Your cost of goods is set by GT3's purchasing, not yours." }); break;
    case "mixed":
      f.push({ k: "Split sourcing",
        v: "GT3 supplies the specified items; you buy the rest locally. Ask which list is which, in writing." }); break;
    default:
      f.push({ k: "Supplies are undecided", heavy: true,
        v: "This agreement does not yet say who buys the supplies. That is not a detail — settle it before you sign, not after." });
  }

  if (o.equityEligible) {
    f.push({ k: "Equity is eligibility, not a grant", heavy: true,
      v: o.equityScope === "market_entity"
        ? "This tier is eligible to be offered equity in a separate entity for this market. Eligible is not the same as granted: nothing here gives you a share, and the actual instrument is a separate document."
        : o.equityScope === "company"
          ? "This tier is eligible to be offered equity in GT3 itself. Eligible is not the same as granted — the actual instrument is a separate document."
          : "This tier is marked eligible for equity, but which entity has not been decided. Ask before you sign." });
  }
  f.push({ k: "You can counter",
    v: "Asking for changes is a normal move, not a rejection. Nothing is binding until you accept it." });
  return f;
}

// ── the employee side ────────────────────────────────────────────────────────────────────────────
export interface PayPoint { label: string; revenueCents: number; totalCents: number }

/**
 * What an offer with a commission actually pays at different volumes. An offer quoting a base and a
 * percentage tells someone almost nothing until they can see it against real revenue.
 */
export function payAtVolumes(
  o: { baseCents?: number | null; ratePer?: string | null; commissionPct?: number | null },
  volumes: { label: string; revenueCents: number }[],
): PayPoint[] {
  const base = cents(o.baseCents ?? 0);
  const annualBase = o.ratePer === "hour" ? base * 2080 : base;   // 40h × 52w, stated where it is used
  const pct = clamp(Number(o.commissionPct) || 0, 0, 100) / 100;
  return volumes.map((v) => ({
    label: v.label,
    revenueCents: cents(v.revenueCents),
    totalCents: annualBase + Math.round(cents(v.revenueCents) * pct),
  }));
}

/** Default volumes to show, so every offer is read against the same three cases. */
export const DEFAULT_VOLUMES = [
  { label: "A slow year", revenueCents: 6_000_000 },
  { label: "On plan", revenueCents: 18_000_000 },
  { label: "A strong year", revenueCents: 36_000_000 },
];

export { TIER, TIERS };
export type { DealTerms, Tier, Stage };
