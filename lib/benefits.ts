import { supabaseAdmin } from "./supabaseAdmin";

// MEMBER BENEFITS — the pricing side of 0176. A benefit is a rule the owner mints as data; the
// server reads the caller's active benefits and applies them at pricing time, authoritative. Pure
// helpers below so the same logic can price the reserve (bottles) and checkout (cups) channels
// identically, and be unit-tested without a DB.

export type Benefit = {
  scope: "tier" | "code";
  tier: string | null;
  code: string | null;
  kind: "free_refill" | "price_override" | "percent_off" | "amount_off";
  target: string | null;        // product slug | 'straight_brew' | null = all
  value_cents: number | null;
  percent: number | null;
  label: string;
};

// The straight-brew family — the order-ahead bottles (RISE/FLOW/DUSK). A 'straight_brew' target
// matches any of these slugs OR the order-ahead pack channel (which is always straight brew).
const STRAIGHT_BREW = new Set(["rise", "flow", "dusk", "straight_brew"]);

// Does a benefit make a bring-back (refill) straight-brew pack free?
export function refillIsFree(benefits: Benefit[]): boolean {
  return benefits.some((b) => b.kind === "free_refill" && (b.target === "straight_brew" || b.target === null));
}

// Order-level percent-off (the whole pack/reserve order). A code minted as percent_off with target
// null or 'straight_brew' discounts the order; price_override targets a specific slug (cups channel),
// so it never applies here. Returns the deepest single percent (they don't stack). Pure.
function percentOffOrder(benefits: Benefit[]): number {
  let pct = 0;
  for (const b of benefits) {
    if (b.kind !== "percent_off") continue;
    if (b.target && b.target !== "straight_brew") continue;   // slug-targeted percent = cups only
    if (typeof b.percent === "number") pct = Math.max(pct, Math.min(100, b.percent));
  }
  return pct;
}

// Order-level flat amount-off (0268 · the '$5 off' QR coupon kind). Deepest single amount; order-
// level only — a $5 cut belongs to a pack total, not a single cup, so priceForSlug never applies it.
function amountOffOrder(benefits: Benefit[]): number {
  let amt = 0;
  for (const b of benefits) {
    if (b.kind !== "amount_off") continue;
    if (b.target && b.target !== "straight_brew") continue;
    if (typeof b.value_cents === "number") amt = Math.max(amt, b.value_cents);
  }
  return amt;
}

// Apply the order-level benefits to a total (cents): deepest percent, then deepest amount, floored
// at 0. (Was applyOrderPercent; renamed when amount_off joined — same call sites, wider truth.)
export function applyOrderBenefits(totalCents: number, benefits: Benefit[]): number {
  const pct = percentOffOrder(benefits);
  const afterPct = pct > 0 ? Math.max(0, Math.round(totalCents * (1 - pct / 100))) : totalCents;
  const amt = amountOffOrder(benefits);
  return amt > 0 ? Math.max(0, afterPct - amt) : afterPct;
}

// The code the engine actually accepted from this request, normalized for the order record — or
// null. Recording redemption only on a VALIDATED code keeps the coupon KPI honest (0268).
export function acceptedCode(benefits: Benefit[], presented?: string | null): string | null {
  if (!presented || !presented.trim()) return null;
  const hit = benefits.find((b) => b.scope === "code" && b.code);
  return hit ? String(hit.code).toUpperCase() : null;
}

// Apply price overrides / percent-off to a single product slug's base price (cents). Best benefit wins.
export function priceForSlug(benefits: Benefit[], slug: string, baseCents: number): number {
  let best = baseCents;
  for (const b of benefits) {
    if (b.target && b.target !== slug && !(b.target === "straight_brew" && STRAIGHT_BREW.has(slug))) continue;
    if (b.kind === "price_override" && typeof b.value_cents === "number") best = Math.min(best, b.value_cents);
    else if (b.kind === "percent_off" && typeof b.percent === "number") best = Math.min(best, Math.round(baseCents * (1 - b.percent / 100)));
  }
  return Math.max(0, best);
}

// Server: the ACTIVE benefits that apply to this caller right now — a signed-in user's tier perks,
// plus any code presented (validated here so a client can't forge one). Codes resolve WITHOUT a
// userId (0268): the $5-off QR card exists to acquire people who aren't customers yet — a guest
// checkout presenting a printed code must price like anyone else. Best-effort: never throws.
export async function benefitsForUser(userId: string | null, code?: string | null): Promise<Benefit[]> {
  if (!supabaseAdmin) return [];
  const out: Benefit[] = [];
  try {
    if (!userId) {
      if (code && code.trim()) {
        const { data } = await supabaseAdmin.from("member_benefits").select("scope, tier, code, kind, target, value_cents, percent, label")
          .eq("active", true).eq("scope", "code").ilike("code", code.trim().replace(/[%_\\]/g, (c) => `\\${c}`));
        out.push(...((data ?? []) as Benefit[]));
      }
      return out;
    }
    const { data: cust } = await supabaseAdmin.from("customers").select("tier, vip_verified").eq("user_id", userId).maybeSingle();
    const tier = (cust as { tier?: string } | null)?.tier ?? "guest";
    // Founding VIP (0250): a bottle-verified Founding member gets every plain-Founding perk PLUS
    // whatever's tagged requires_vip — additive, not a separate track. A non-VIP customer just never
    // matches the requires_vip=true rows, so they're filtered out at the query, not the client.
    const vipVerified = Boolean((cust as { vip_verified?: boolean } | null)?.vip_verified);
    if (tier !== "guest") {
      let q = supabaseAdmin.from("member_benefits").select("scope, tier, code, kind, target, value_cents, percent, label")
        .eq("active", true).eq("scope", "tier").eq("tier", tier);
      if (!vipVerified) q = q.eq("requires_vip", false);
      const { data } = await q;
      out.push(...((data ?? []) as Benefit[]));
    }
    if (code && code.trim()) {
      // exact redeemable code, case-insensitive — escape LIKE wildcards so a member can't send
      // "%" (or "_") and match EVERY code-scoped benefit (discount forgery / revenue leak).
      const { data } = await supabaseAdmin.from("member_benefits").select("scope, tier, code, kind, target, value_cents, percent, label")
        .eq("active", true).eq("scope", "code").ilike("code", code.trim().replace(/[%_\\]/g, (c) => `\\${c}`));
      out.push(...((data ?? []) as Benefit[]));
    }
  } catch { /* pricing must not break if benefits are unreachable */ }
  return out;
}
