import type { SupabaseClient } from "@supabase/supabase-js";
import type { MenuRow } from "./drinks";

// ── THE READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// One read of the products the menu shows, for /api/menu, checkout and Ask us. A failed read is an error, never an empty
// menu.
export async function readMenuRows(sb: SupabaseClient, slugs?: readonly string[]): Promise<{ rows: MenuRow[]; error: string | null }> {
  const cols = "slug, name, line, price_cents, sort, what, why, ingredients, excludes, timing, accent, sold_out, active, cup_orderable, caffeine, contains, tag, when_text";
  const r = slugs ? await sb.from("products").select(cols).in("slug", [...slugs]) : await sb.from("products").select(cols);
  return r.error ? { rows: [], error: r.error.message } : { rows: (r.data ?? []) as MenuRow[], error: null };
}

// ── AN 86 IN ONE CITY (2026-10-15, 0408) ─────────────────────────────────────────────────────────────────────────────
// Which of these slugs are sold out in this city (product_86, the Pass's 86 board), for the charge's own check before the
// card: the order's insert refuses them in any case (0408's check_order_availability) — after the money, by then.
// A failed read is an error, never "none sold out". No slugs given: every item out in the city (the concierge's menu).
export async function readCityOut(sb: SupabaseClient, market: string, slugs?: readonly string[]): Promise<{ out: Set<string>; error: string | null }> {
  if (slugs && !slugs.length) return { out: new Set(), error: null };
  const all = sb.from("product_86").select("products!inner(slug)").eq("market", market);
  const r = slugs ? await all.in("products.slug", [...slugs]) : await all;
  if (r.error) return { out: new Set(), error: r.error.message };
  const out = new Set<string>();
  for (const row of (r.data ?? []) as { products: { slug: string } | { slug: string }[] | null }[]) {
    for (const p of Array.isArray(row.products) ? row.products : row.products ? [row.products] : []) if (p.slug) out.add(p.slug);
  }
  return { out, error: null };
}
