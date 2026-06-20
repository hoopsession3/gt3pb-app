import { NextResponse } from "next/server";

// Prices come from Square Catalog (single source of truth for truck + app).
// Returns { prices: { rise: 700, flow: 700, ... } } keyed by lowercased item name.
// Empty when Square isn't configured → the app falls back to the locked catalog.
export async function GET() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ prices: {} });

  const base =
    process.env.NEXT_PUBLIC_SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  try {
    const res = await fetch(`${base}/v2/catalog/list?types=ITEM`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" },
      // catalog changes rarely; let the platform cache briefly
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const obj of data?.objects ?? []) {
      const name = obj?.item_data?.name?.toLowerCase();
      const amount = obj?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      if (name && typeof amount === "number") prices[name] = amount;
    }
    return NextResponse.json({ prices });
  } catch {
    return NextResponse.json({ prices: {} });
  }
}
