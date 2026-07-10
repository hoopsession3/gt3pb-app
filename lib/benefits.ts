import { supabaseAdmin } from "./supabaseAdmin";

// MEMBER BENEFITS — the pricing side of 0176. A benefit is a rule the owner mints as data; the
// server reads the caller's active benefits and applies them at pricing time, authoritative. Pure
// helpers below so the same logic can price the reserve (bottles) and checkout (cups) channels
// identically, and be unit-tested without a DB.

export type Benefit = {
  scope: "tier" | "code";
  tier: string | null;
  code: string | null;
  kind: "free_refill" | "price_override" | "percent_off";
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

// Server: the ACTIVE benefits that apply to a signed-in user right now — their tier's perks, plus
// any code they present (validated here so a client can't forge one). Best-effort: never throws.
export async function benefitsForUser(userId: string | null, code?: string | null): Promise<Benefit[]> {
  if (!supabaseAdmin || !userId) return [];
  const out: Benefit[] = [];
  try {
    const { data: cust } = await supabaseAdmin.from("customers").select("tier").eq("user_id", userId).maybeSingle();
    const tier = (cust as { tier?: string } | null)?.tier ?? "guest";
    if (tier !== "guest") {
      const { data } = await supabaseAdmin.from("member_benefits").select("scope, tier, code, kind, target, value_cents, percent, label")
        .eq("active", true).eq("scope", "tier").eq("tier", tier);
      out.push(...((data ?? []) as Benefit[]));
    }
    if (code && code.trim()) {
      const { data } = await supabaseAdmin.from("member_benefits").select("scope, tier, code, kind, target, value_cents, percent, label")
        .eq("active", true).eq("scope", "code").ilike("code", code.trim());
      out.push(...((data ?? []) as Benefit[]));
    }
  } catch { /* pricing must not break if benefits are unreachable */ }
  return out;
}
