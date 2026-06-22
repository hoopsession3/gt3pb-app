import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DRINKS, type DrinkId } from "@/lib/menu";

interface OrderItem { id: DrinkId; qty: number }

// Creates a Square payment for a pre-order (when a card token is supplied) and/or records the
// order so it lands in the truck's fulfillment queue. The amount is computed SERVER-SIDE from the
// item ids + quantities (never trust a client-supplied total). Secrets stay server-only.
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;

  let body: { sourceId?: string; items?: OrderItem[]; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { sourceId, items, accessToken } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }

  // Server-side total + line items from the locked catalog, in cents.
  let amount = 0;
  const lineItems: { id: DrinkId; name: string; qty: number; unit_cents: number }[] = [];
  for (const { id, qty } of items) {
    const d = DRINKS[id];
    if (!d) return NextResponse.json({ error: `Unknown item: ${id}` }, { status: 400 });
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return NextResponse.json({ error: `Bad quantity for ${id}` }, { status: 400 });
    }
    const unit = Math.round(parseFloat(d.px.replace("$", "")) * 100);
    amount += unit * qty;
    lineItems.push({ id, name: d.n, qty, unit_cents: unit });
  }

  // ── charge the card, if one was supplied ──
  let paid = false;
  let paymentId: string | null = null;
  if (sourceId) {
    if (!token || !locationId) {
      return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
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
      paid = true;
      paymentId = data?.payment?.id ?? null;
    } catch {
      return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
    }
  }

  // ── persist the order (best-effort) so the truck's queue sees it ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let orderRecorded = false;
  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
      // Attribute to the signed-in member when their token is present (verified, not trusted).
      let userId: string | null = null;
      if (accessToken) {
        const { data } = await admin.auth.getUser(accessToken);
        userId = data.user?.id ?? null;
      }
      const { data: ls } = await admin.from("live_status").select("current_stop_id").maybeSingle();
      const { error } = await admin.rpc("record_order", {
        p_user: userId,
        p_stop: ls?.current_stop_id ?? null,
        p_total_cents: amount,
        p_paid: paid,
        p_payment_id: paymentId,
        p_items: lineItems,
      });
      orderRecorded = !error;
    } catch {
      // A paid order must never fail because the queue write hiccuped — the charge already went through.
      orderRecorded = false;
    }
  }

  return NextResponse.json({ ok: true, paid, paymentId, amount, orderRecorded });
}
