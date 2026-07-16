import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DRINKS, type DrinkId } from "@/lib/menu";

// Prices for the app (card AND cash). Source of truth is the managed `products` table; Square is a
// secondary sync. Returns { prices: { rise: 700, ... } } keyed by slug. Empty → app uses the locked
// lib/menu.ts catalog as a final fallback.
export async function GET() {
  // 1) managed products (public read of active rows)
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon) {
      const sb = createClient(url, anon, { auth: { persistSession: false } });
      const { data } = await sb.from("products").select("slug, price_cents, active").eq("active", true);
      if (data && data.length) {
        const prices: Record<string, number> = {};
        for (const p of data) if (p.slug && typeof p.price_cents === "number") prices[p.slug] = p.price_cents;
        return NextResponse.json({ prices, source: "products" });
      }
    }
  } catch { /* fall through to Square */ }

  // 2) Square catalog
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ prices: {} });
  const base = process.env.NEXT_PUBLIC_SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  // Square has no concept of our slugs, so its items are matched back to one by DISPLAY NAME. For 7
  // of 10 items the lowercased name happens to equal the slug (rise, flow, dusk, tide, forge, hunt,
  // wild), which used to mask this bug: kingme ("KING ME"), maple ("SALTED MAPLE LATTE"), and aide
  // ("NATURE'S AIDE") don't match their slug — so keying this map by name silently missed the live
  // Square price for those 3 and fell through to the stale lib/menu.ts price instead (the docstring
  // above promises `prices` keyed by slug; the old code broke that promise for exactly these 3).
  const nameToSlug: Record<string, DrinkId> = {};
  for (const slug of Object.keys(DRINKS) as DrinkId[]) nameToSlug[DRINKS[slug].n.toLowerCase()] = slug;
  try {
    const res = await fetch(`${base}/v2/catalog/list?types=ITEM`, { headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" }, next: { revalidate: 60 } });
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const obj of data?.objects ?? []) {
      const name = obj?.item_data?.name?.toLowerCase();
      const amount = obj?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      const slug = name ? nameToSlug[name] : undefined;
      if (slug && typeof amount === "number") prices[slug] = amount;
    }
    return NextResponse.json({ prices, source: "square" });
  } catch {
    return NextResponse.json({ prices: {} });
  }
}
