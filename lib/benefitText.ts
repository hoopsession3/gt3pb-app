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

// ── WHERE A BENEFIT APPLIES (2026-10-04, the form audit) ────────────────────────────────────────
//
// "Applies to" was a four-item constant, copied into both panels: Whole order, the straight-brew
// family, Salted Maple Latte, and "Latte (bulk)". A target IS a products.slug (0176 — lib/benefits
// matches it by slug), so a code for TIDE, FORGE or KING ME could not be minted without a deploy, on
// a panel that promises "no deploy". And the constant could mint a code that changes nothing:
//
//   · "Latte (bulk)" is salted-latte, which the checkout does not sell — /api/checkout prices only
//     the cups in lib/menu and refuses anything else — so no price it names is ever met. 0176 seeded
//     a Founding perk on it ("$8 latte (bulk)") that has never applied to anyone;
//   · Free and $-off apply to a whole order-ahead pack (lib/benefits refillIsFree, amountOffOrder),
//     never to one cup — aimed at a single drink they reach nothing.
//
// So the choices are now the products the checkout actually prices, with the family and the whole
// order, and only the ones the chosen kind can reach; and a rule already on file that reaches
// nothing says so on its row. Pure — the panels read the products, this decides what they mean.

export type BenefitKind = "percent_off" | "price_override" | "free_refill" | "amount_off";

/**
 * What each kind can reach. lib/benefits APPLIES these rules; scripts/smoke.cjs runs its functions
 * against this table so the two cannot drift. One difference is deliberate: a set price on the WHOLE
 * order would set every cup to one price. The engine would do it; the forms refuse it.
 */
export const KIND_REACH: Record<BenefitKind, { whole: boolean; family: boolean; product: boolean }> = {
  percent_off: { whole: true, family: true, product: true },
  price_override: { whole: false, family: true, product: true },
  amount_off: { whole: true, family: true, product: false },
  free_refill: { whole: true, family: true, product: false },
};

/** The straight-brew family's target, and its cups (lib/benefits' STRAIGHT_BREW less the key itself). */
export const FAMILY_TARGET = "straight_brew";
export const FAMILY_SLUGS: readonly string[] = ["rise", "flow", "dusk"];
const FAMILY_LABEL = "Straight brew (Rise/Flow/Dusk)";

/** A product as the panels know it — `cup` is whether the checkout sells it (lib/menu's DRINKS). */
export type TargetProduct = { slug: string; name: string; price_cents: number | null; active: boolean; cup: boolean };
export type TargetChoice = { value: string; label: string };

const reachOf = (kind: string) => KIND_REACH[kind as BenefitKind] ?? null;

/** The targets this kind can reach: the whole order and the family where they apply, then every cup
 *  the checkout sells — on the menu first, the rest marked. */
export function targetChoices(kind: string, products: readonly TargetProduct[]): TargetChoice[] {
  const r = reachOf(kind);
  if (!r) return [{ value: "", label: "Whole order" }];
  const out: TargetChoice[] = [];
  if (r.whole) out.push({ value: "", label: "Whole order" });
  if (r.family) out.push({ value: FAMILY_TARGET, label: FAMILY_LABEL });
  if (r.product) {
    const cups = products.filter((p) => p.cup);
    for (const p of [...cups.filter((p) => p.active), ...cups.filter((p) => !p.active)]) {
      out.push({ value: p.slug, label: p.active ? p.name : `${p.name} (off the menu)` });
    }
  }
  return out;
}

/** Where a rule on file applies, as its row reads. */
export function targetLabel(target: string | null | undefined, products: readonly TargetProduct[]): string {
  if (!target) return "Whole order";
  if (target === FAMILY_TARGET) return FAMILY_LABEL;
  return products.find((p) => p.slug === target)?.name ?? target;
}

/** What a kind aimed at a target does, in one line — said under the form before anything is minted. */
export function reachText(kind: string, target: string | null | undefined, products: readonly TargetProduct[]): string {
  const name = targetLabel(target, products);
  if (kind === "amount_off") return "Comes off an order-ahead pack's total — never off a cup.";
  if (kind === "free_refill") return "An order-ahead refill pack — bottles brought back — costs nothing.";
  if (kind === "percent_off") {
    if (!target) return "Every cup at checkout, and every order-ahead pack.";
    if (target === FAMILY_TARGET) return "Rise, Flow and Dusk by the cup, and every order-ahead pack.";
    return `${name} by the cup, at checkout.`;
  }
  if (kind === "price_override") {
    if (!target) return "Choose the drink it sets the price of.";
    if (target === FAMILY_TARGET) return "Rise, Flow and Dusk by the cup, at checkout.";
    return `${name} by the cup, at checkout.`;
  }
  return "";
}

/**
 * Why a rule on file changes no price — or null when it reaches something. Said after the target's
 * own name on the rule's row, so it does not repeat it. With the products not read (null), only what
 * the kind alone decides is judged: not knowing the menu is not the same as a drink being off it.
 */
export function reachesNothing(kind: string, target: string | null | undefined, products: readonly TargetProduct[] | null): string | null {
  const r = reachOf(kind);
  if (!r || !target || target === FAMILY_TARGET) return null;
  if (!r.product) {
    return kind === "amount_off"
      ? "$ off comes off a pack's total, not one drink — this changes no price."
      : "Free applies to a refill pack, not one drink — this changes no price.";
  }
  if (!products) return null;
  const p = products.find((x) => x.slug === target);
  if (!p) return "not on the menu — this changes no price.";
  if (!p.cup) return "not sold through the checkout — this changes no price.";
  return null;
}

/** The menu price a set price is weighed against: one cup's, or the family's range. */
export function menuPriceOf(target: string | null | undefined, products: readonly TargetProduct[]): { low: number; high: number } | null {
  const slugs = target === FAMILY_TARGET ? FAMILY_SLUGS : target ? [target] : [];
  const prices = products.filter((p) => slugs.includes(p.slug) && typeof p.price_cents === "number").map((p) => p.price_cents as number);
  return prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : null;
}
