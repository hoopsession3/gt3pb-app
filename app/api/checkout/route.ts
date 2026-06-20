import { NextResponse } from "next/server";
import { DRINKS, type DrinkId } from "@/lib/menu";

// Creates a Square payment for a pre-order. The amount is computed SERVER-SIDE from the
// item ids (never trust a client-supplied total). The access token is server-only.
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; items?: DrinkId[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { sourceId, items } = body;
  if (!sourceId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }

  // Server-side total — dollars from the locked catalog, in cents.
  let amount = 0;
  for (const id of items) {
    const d = DRINKS[id];
    if (!d) return NextResponse.json({ error: `Unknown item: ${id}` }, { status: 400 });
    amount += Math.round(parseFloat(d.px.replace("$", "")) * 100);
  }

  const base =
    process.env.NEXT_PUBLIC_SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  try {
    const res = await fetch(`${base}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: { amount, currency: "USD" },
        location_id: locationId,
        note: "GT3PB pre-order",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.errors?.[0]?.detail || "Payment declined";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true, paymentId: data?.payment?.id, amount });
  } catch {
    return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }
}
