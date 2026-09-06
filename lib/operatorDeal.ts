// OPERATOR DEAL — the economics of a market operator agreement.
//
// Pure + deterministic (no DOM, no env, no I/O), the same contract lib/markets, lib/equipment and
// lib/orderAhead hold, so it runs identically on the server, in the builder UI, and under the smoke
// suite. The money math for a real agreement belongs in a tested module, not scattered in a form.
//
// THE ANCHOR. The house position is the one already agreed: once a market is profitable the operator
// takes 50% of commissions, 30% returns to GT3 as royalty, and the remaining 20% is reinvested in the
// market. That is not an arbitrary midpoint — it is the deal, and every other position on the slider
// is a principled deviation from it.
//
// THE TRADE THE SLIDER MAKES. Who funds supplies is the real variable, because it is who carries the
// capital and the risk. So supply funding and operator share move together:
//
//     GT3 funds everything  ────────────── 50 / 30 / 20 ────────────── operator funds everything
//     operator 35 · royalty 45              (the anchor)               operator 65 · royalty 15
//
// The market's 20% reinvestment is HELD CONSTANT across the whole range. A market that stops
// reinvesting stops growing, and that is not a term either side should be able to trade away.
//
// RAMP VS PROFITABLE. Before a market is profitable there are no profits to take a royalty from.
// During ramp the royalty is zero and that entire share redirects into the market rather than to
// GT3 — the market keeps its own money until it can stand up. Royalty begins at profitability.

import { type Market } from "./markets";

// ── stage ─────────────────────────────────────────────────────────────────────────────────────────
export const STAGES = ["ramp", "profitable"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  ramp: "Ramp — not yet profitable",
  profitable: "Profitable",
};

// ── tier ("next levels") ──────────────────────────────────────────────────────────────────────────
// A tier lifts the operator's share, and the lift comes out of ROYALTY, never out of the market's
// reinvestment. Progression costs GT3, not the market.
export const TIERS = ["associate", "operator", "senior", "partner"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierSpec { label: string; uplift: number; advance: string }
export const TIER: Record<Tier, TierSpec> = {
  associate: { label: "Associate", uplift: 0, advance: "Run the market to a first standing corporate account." },
  operator: { label: "Operator", uplift: 5, advance: "Three months profitable, three standing accounts live." },
  senior: { label: "Senior Operator", uplift: 10, advance: "Six months profitable and a second operator trained." },
  partner: { label: "Market Partner", uplift: 15, advance: "Top tier — the next step is equity, negotiated separately." },
};
export const nextTier = (t: Tier): Tier | null => {
  const i = TIERS.indexOf(t);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
};

// ── the anchored split ────────────────────────────────────────────────────────────────────────────
/** Reinvestment is constant across the slider — deliberately not negotiable. */
export const MARKET_REINVEST_PCT = 20;
/** Operator share at each end of the supply-funding slider. Midpoint lands exactly on 50/30/20. */
export const OPERATOR_PCT_MIN = 35; // GT3 funds all supplies
export const OPERATOR_PCT_MAX = 65; // operator funds all supplies

export interface DealTerms {
  /** 0–100: the share of SUPPLY COST the operator funds. 0 = GT3 funds everything. */
  supplyFunding: number;
  stage: Stage;
  tier: Tier;
}

export interface DealSplit {
  operatorPct: number;
  royaltyPct: number;
  marketPct: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The three-way split for a set of terms. The three always total exactly 100 — market is computed as
 * the remainder rather than stated independently, so the invariant cannot drift.
 */
export function computeSplit(terms: DealTerms): DealSplit {
  const funding = clamp(Number(terms.supplyFunding) || 0, 0, 100);
  const uplift = TIER[terms.tier]?.uplift ?? 0;

  // Linear across the funding range, then the tier lift on top.
  let operatorPct = OPERATOR_PCT_MIN + (OPERATOR_PCT_MAX - OPERATOR_PCT_MIN) * (funding / 100) + uplift;

  if (terms.stage === "ramp") {
    // No profit, so no royalty. Everything the operator doesn't take stays in the market.
    operatorPct = round1(clamp(operatorPct, 0, 100));
    return { operatorPct, royaltyPct: 0, marketPct: round1(100 - operatorPct) };
  }

  // Profitable: the market's reinvestment is protected first, royalty takes the remainder.
  operatorPct = clamp(operatorPct, 0, 100 - MARKET_REINVEST_PCT);
  operatorPct = round1(operatorPct);
  const royaltyPct = round1(100 - operatorPct - MARKET_REINVEST_PCT);
  return { operatorPct, royaltyPct, marketPct: MARKET_REINVEST_PCT };
}

// ── what it actually means in money ───────────────────────────────────────────────────────────────
// The split alone hides the real trade: an operator who funds supplies takes a bigger share of a
// smaller net. The builder shows both, because a term nobody can evaluate is a term nobody should sign.
export interface Projection {
  revenueCents: number;
  suppliesCents: number;
  split: DealSplit;
  operatorGrossCents: number;   // the operator's share of commissions
  royaltyCents: number;         // back to GT3
  marketCents: number;          // reinvested in the market
  operatorSuppliesCents: number; // what the operator funds
  gt3SuppliesCents: number;      // what GT3 funds
  operatorNetCents: number;      // operator gross less their supply share — the number that matters
}

const pctOf = (cents: number, pct: number) => Math.round(cents * (pct / 100));

export function project(terms: DealTerms, revenueCents: number, suppliesCents: number): Projection {
  const rev = Math.max(0, Math.round(revenueCents) || 0);
  const sup = Math.max(0, Math.round(suppliesCents) || 0);
  const split = computeSplit(terms);
  const funding = clamp(Number(terms.supplyFunding) || 0, 0, 100);

  const operatorGrossCents = pctOf(rev, split.operatorPct);
  const royaltyCents = pctOf(rev, split.royaltyPct);
  // Remainder, so the three shares always reconstruct revenue exactly — no rounding leak.
  const marketCents = rev - operatorGrossCents - royaltyCents;

  const operatorSuppliesCents = pctOf(sup, funding);
  const gt3SuppliesCents = sup - operatorSuppliesCents;

  return {
    revenueCents: rev, suppliesCents: sup, split,
    operatorGrossCents, royaltyCents, marketCents,
    operatorSuppliesCents, gt3SuppliesCents,
    operatorNetCents: operatorGrossCents - operatorSuppliesCents,
  };
}

/**
 * The funding position where the operator's NET is highest for a given revenue and supply cost —
 * the honest answer to "where on this slider am I actually better off", which is not always the end.
 */
export function bestFundingForOperator(terms: DealTerms, revenueCents: number, suppliesCents: number): number {
  let best = 0, bestNet = -Infinity;
  for (let f = 0; f <= 100; f += 5) {
    const net = project({ ...terms, supplyFunding: f }, revenueCents, suppliesCents).operatorNetCents;
    if (net > bestNet) { bestNet = net; best = f; }
  }
  return best;
}

// ── the negotiation ───────────────────────────────────────────────────────────────────────────────
// A proposal that can only be accepted is not a proposal. The operator can ask for changes or send a
// counter, and either side can walk it back to draft — the trail of who moved what is the record.
export const AGREEMENT_STATUS = ["draft", "sent", "changes_requested", "countered", "accepted", "active", "ended"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUS)[number];

export const STATUS_LABEL: Record<AgreementStatus, string> = {
  draft: "Draft",
  sent: "Sent for review",
  changes_requested: "Changes requested",
  countered: "Counter-proposed",
  accepted: "Accepted",
  active: "Active",
  ended: "Ended",
};

const FLOW: Record<AgreementStatus, readonly AgreementStatus[]> = {
  draft: ["sent"],
  sent: ["changes_requested", "countered", "accepted", "draft"],
  changes_requested: ["sent", "draft"],
  countered: ["accepted", "changes_requested", "sent", "draft"],
  accepted: ["active", "draft"],
  active: ["ended"],
  ended: [],
};

export const canAdvance = (from: AgreementStatus, to: AgreementStatus): boolean =>
  from !== to && FLOW[from].includes(to);
export const nextStatuses = (from: AgreementStatus): readonly AgreementStatus[] => FLOW[from];
/** Terms are only editable before anyone has agreed to them. */
export const isEditable = (s: AgreementStatus): boolean => s === "draft" || s === "changes_requested" || s === "countered";
/** Live and binding. */
export const isBinding = (s: AgreementStatus): boolean => s === "active";

export const isStatus = (v: unknown): v is AgreementStatus =>
  typeof v === "string" && (AGREEMENT_STATUS as readonly string[]).includes(v);
export const toStatus = (v: unknown): AgreementStatus => (isStatus(v) ? v : "draft");
export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);
export const toTier = (v: unknown): Tier => (isTier(v) ? v : "associate");
export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);
export const toStage = (v: unknown): Stage => (isStage(v) ? v : "ramp");

export type Validation = { ok: true } | { ok: false; error: string };

/** A proposal must be complete enough that the other side can actually evaluate it. */
export function validateProposal(t: { market?: unknown; terms?: DealTerms | null; operatorName?: unknown }): Validation {
  if (!t.market) return { ok: false, error: "Pick the market this agreement covers." };
  const name = typeof t.operatorName === "string" ? t.operatorName.trim() : "";
  if (name.length < 2) return { ok: false, error: "Name the operator this is for." };
  if (!t.terms) return { ok: false, error: "Set the terms before sending." };
  const f = Number(t.terms.supplyFunding);
  if (!Number.isFinite(f) || f < 0 || f > 100) return { ok: false, error: "Supply funding has to sit between 0 and 100%." };
  const s = computeSplit(t.terms);
  if (s.royaltyPct < 0) return { ok: false, error: "These terms push royalty below zero — lower the operator share or the tier." };
  return { ok: true };
}

/** One-line summary for a list row or a notification. */
export function summarize(terms: DealTerms, market: Market): string {
  const s = computeSplit(terms);
  const who = terms.supplyFunding === 0 ? "GT3 funds supplies"
    : terms.supplyFunding === 100 ? "operator funds supplies"
    : `supplies ${terms.supplyFunding}/${100 - terms.supplyFunding} operator/GT3`;
  return `${market} · ${TIER[terms.tier].label} · ${s.operatorPct}/${s.royaltyPct}/${s.marketPct} · ${who}`;
}
