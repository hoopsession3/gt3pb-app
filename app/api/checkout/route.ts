import { NextResponse } from "next/server";
import { DRINKS, type DrinkId } from "@/lib/menu";

const SQUARE_BASE =
  process.env.NEXT_PUBLIC_SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

// Authoritative prices from Square Catalog; fall back to the locked catalog if unavailable.
async function priceMap(token: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" },
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const m: Record<string, number> = {};
    for (const o of data?.objects ?? []) {
      const n = o?.item_data?.name?.toLowerCase();
      const a = o?.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount;
      if (n && typeof a === "number") m[n] = a;
    }
    return m;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });

  let body: { sourceId?: string; items?: DrinkId[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const { sourceId, items } = body;
  if (!sourceId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }
  if (items.length > 25) return NextResponse.json({ error: "Order too large" }, { status: 400 });

  const prices = await priceMap(token);
  let amount = 0;
  for (const id of items) {
    if (!DRINKS[id]) return NextResponse.json({ error: `Unknown item: ${id}` }, { status: 400 });
    amount += prices[id] ?? Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);
  }

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": "2025-01-23" },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount, currency: "USD" },
        location_id: locationId,
        note: "GT3PB pre-order",
      }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.detail || "Payment declined" }, { status: 400 });
    return NextResponse.json({ ok: true, paymentId: data?.payment?.id, amount });
  } catch {
    return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }
}
