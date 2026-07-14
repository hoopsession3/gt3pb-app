import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_BASE, squareHeaders, safeIdemKey } from "@/lib/squareServer";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
// OFFICE PAYMENT LINK — the app creates the Square payment link for a prepaid office order (crew used
// to text one by hand from Square, so the app never saw the payment id). The link's Square order id is
// stored on the business_order; when the customer pays, the webhook matches payment.order_id →
// square_order_id, auto-marks it paid, and stores payment_id (which also powers the walk-up dedupe,
// 0220). Idempotent: same order → same link. Staff-gated.
export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ ok: false, error: "Square isn't configured" }, { status: 503 });

  let orderId = "";
  try { ({ orderId } = await req.json()); } catch { /* */ }
  if (!orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });

  const { data: o } = await supabaseAdmin.from("business_orders")
    .select("id, company, gallons, total_cents, payment_status, paylink_url, canceled_at").eq("id", orderId).maybeSingle();
  if (!o) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (o.canceled_at) return NextResponse.json({ ok: false, error: "order is canceled" }, { status: 400 });
  if (o.payment_status === "paid") return NextResponse.json({ ok: false, error: "already paid" }, { status: 400 });
  if (!o.total_cents || o.total_cents <= 0) return NextResponse.json({ ok: false, error: "order has no total" }, { status: 400 });
  if (o.paylink_url) return NextResponse.json({ ok: true, url: o.paylink_url });   // same order → same link

  const res = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      idempotency_key: safeIdemKey(`paylink-${o.id}`),
      quick_pay: {
        name: `GT3 office — ${o.company} · ${Math.round(o.gallons)} gal`.slice(0, 255),
        price_money: { amount: o.total_cents, currency: "USD" },
        location_id: locationId,
      },
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  const link = j?.payment_link;
  if (!res.ok || !link?.url) {
    return NextResponse.json({ ok: false, error: j?.errors?.[0]?.detail ?? "Square couldn't create the link" }, { status: 502 });
  }
  // The linkage IS the feature — if it doesn't save, the webhook can never auto-mark this order paid.
  // Fail loudly; the Square idempotency key means a retry returns the very same link.
  const { error: linkErr } = await supabaseAdmin.from("business_orders")
    .update({ square_order_id: link.order_id ?? null, paylink_url: link.url }).eq("id", o.id);
  if (linkErr) return NextResponse.json({ ok: false, error: "Link created but didn't save — tap again" }, { status: 502 });
  return NextResponse.json({ ok: true, url: link.url });
}
