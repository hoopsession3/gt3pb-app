// ACTIVATION ECONOMICS (0268 · Playbook v1.1 §05) — the ONE place the budget bands and payback
// math live, so the pipeline card's uplift rail and the weekly review narrate from identical
// numbers. Bands are the doc's market-checked Aug-2026 figures; when v1.2 re-checks them, this
// file is the only edit.

export type Band = { lo: number; hi: number; label: string };

// §05 by channel, in cents. The band is picked from the account's CAT tag (opportunities.category,
// free text like 'WHSL+PRTNR · P1'). PRTNR wins when present — the cooler install is the big
// activation an account of that shape is walking toward; wholesale/corporate is per-account;
// events & retail stops are per-outing. No tag → no band; the rail shows spend alone (honest).
const BANDS: { match: RegExp; band: Band }[] = [
  { match: /PRTNR|COOLER/i,          band: { lo: 63_500, hi: 106_500, label: "cooler install" } },
  { match: /WHSL|WHOLESALE|CORP/i,   band: { lo: 13_500, hi: 13_500,  label: "per account" } },
  { match: /EVENT/i,                 band: { lo: 15_000, hi: 50_000,  label: "per event" } },
  { match: /RETAIL|W\/R/i,           band: { lo: 15_000, hi: 50_000,  label: "per stop" } },
];
export function bandFor(category: string | null | undefined): Band | null {
  if (!category) return null;
  for (const b of BANDS) if (b.match.test(category)) return b.band;
  return null;
}

// Phase-1 GTM activation plan, mid-case (§05 p.9): gate ~$2.1K + three coolers ~$2.6K + six
// corporate ~$810 + event float ~$600 ≈ $6.0K. The Command Board's roll-up meters against this.
export const PHASE1_PLAN_CENTS = 600_000;

// Fallback blended gross margin when product economics aren't readable in this session. When they
// are, callers pass the REAL blended margin from product_economics_live — the same figure the deal
// floor already prices against, so payback and deal math never disagree.
export const FALLBACK_MARGIN_PCT = 55;

// GP recovered so far against spend, as a whole percent (null when nothing spent).
export function paybackPct(revenueCents: number, spendCents: number, marginPct: number): number | null {
  if (spendCents <= 0) return null;
  return Math.round((revenueCents * (marginPct / 100)) / spendCents * 100);
}

// The §05 projection for a LIVE account: weeks to clear remaining spend at current MRR × margin.
// (The doc's own method — "payback ~$1,330 GP/mo at 15% → 2–3 weeks".)
export function paybackWeeks(spendCents: number, gpSoFarCents: number, mrrCents: number, marginPct: number): number | null {
  const remaining = spendCents - gpSoFarCents;
  if (remaining <= 0) return 0;
  const gpPerWeek = (mrrCents * (marginPct / 100)) / 4.345;
  if (gpPerWeek <= 0) return null;
  return Math.ceil(remaining / gpPerWeek);
}

export const fmtBand = (b: Band) =>
  b.lo === b.hi ? `~$${Math.round(b.lo / 100).toLocaleString()}` : `$${Math.round(b.lo / 100).toLocaleString()}–${Math.round(b.hi / 100).toLocaleString()}`;
