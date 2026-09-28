import { money } from "./money";

// HOW A BENEFIT READS — one home for the sentence, because there were two and they had drifted.
//
// components/CodesPanel.tsx and components/PerksPanel.tsx each carried their own `valueText`,
// near-identical and quietly different in the way that matters:
//
//   CodesPanel   percent_off | price_override | amount_off | (else) "Free"
//   PerksPanel   percent_off | price_override |            | (else) "Free"
//
// So a perk with kind "amount_off" — the $5-off QR card lib/benefits prices correctly — rendered
// in the perks panel as "Free". Not a typo, not a rounding slip: an owner reading that screen was
// told a $5 discount gives the whole order away. The duplication did not cause a cosmetic
// difference; it caused one screen to describe a rule as something else entirely.
//
// AND BOTH PRINTED NULL AS ZERO. `$${((r.value_cents ?? 0) / 100).toFixed(2)}` renders "$0.00" for
// a benefit whose amount was never set — which reads as free, the same wrong answer arrived at a
// second way. money() renders an unknown amount as "—", which is the honest thing a reader can
// act on.
//
// lib/benefits.ts is where the four kinds are defined and applied, but it imports supabaseAdmin
// and cannot be exercised without a database. This is the text layer, pure, so the sentence every
// owner reads is covered by the smoke suite.

/** The shape both panels already hold. Structural on purpose — CodeRow and PerkRow both satisfy it. */
export type BenefitLike = {
  kind: string | null;
  percent?: number | null;
  value_cents?: number | null;
};

/**
 * What this benefit gives, in words.
 *
 * Every kind lib/benefits knows is handled here, and an unknown kind falls through to "Free"
 * exactly as both panels already did — that fallback is load-bearing for `free_refill`, which has
 * no number of its own. A kind that carries an amount but has none set reads "—" rather than a
 * confident "$0.00", because zero is an answer and unknown is not.
 */
export function benefitValueText(b: BenefitLike): string {
  const kind = String(b?.kind ?? "").trim();
  if (kind === "percent_off") {
    const p = b.percent;
    return p == null || !Number.isFinite(Number(p)) ? "—" : `${Number(p)}% off`;
  }
  if (kind === "price_override") return money(b.value_cents ?? null);
  if (kind === "amount_off") {
    const m = money(b.value_cents ?? null);
    return m === "—" ? "—" : `${m} off`;
  }
  return "Free";
}
