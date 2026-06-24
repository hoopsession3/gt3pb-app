import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  try {
    const res = await fetch(`${base}/v2/catalog/list?types=ITEM`, { headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" }, next: { revalidate: 60 } });
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const obj of data?.objects ?? []) {
      const name = obj?.item_data?.name?.toLowerCase();
      const amount = obj?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      if (name && typeof amount === "number") prices[name] = amount;
    }
    return NextResponse.json({ prices, source: "square" });
  } catch {
    return NextResponse.json({ prices: {} });
  }
}
