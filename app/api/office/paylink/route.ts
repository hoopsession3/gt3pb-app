import { NextResponse } from "next/server";
import { staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_BASE, squareHeaders, safeIdemKey, squareDeadline } from "@/lib/squareServer";
import { switchOffPaylink } from "@/lib/officeLink";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// OFFICE PAYMENT LINK — the app creates the Square payment link for a prepaid office order (crew used
// to text one by hand from Square, so the app never saw the payment id). The link's Square order id is
// stored on the business_order; when the customer pays, the webhook matches payment.order_id →
// square_order_id, auto-marks it paid, and stores payment_id (which also powers the walk-up dedupe,
// 0220). Idempotent: same order → same link. Staff-gated.
// ITS ID IS KEPT, AND IT CAN BE SWITCHED OFF (R9, 0417). The link's own Square id goes on the order (paylink_id), so a
// cancel (app/api/office/cancel) can delete it; and `{ orderId, off: true }` switches it off when the order is paid another
// way ("Mark paid") — a link left live was paid a second time, and nothing said so.
async function post(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // R-002: staff-gated, so any crew member may act on any order — within THEIR tenant. Without
  // this filter the service role would reach every tenant's orders once a second one exists.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ ok: false, error: "Square isn't configured" }, { status: 503 });

  let body: { orderId?: unknown; off?: unknown } = {};
  try { const raw: unknown = await req.json(); if (raw && typeof raw === "object") body = raw; } catch { /* an empty body names no order: said below */ }
  // An id that is not one is a bad request, never a read the database refuses (that was a 503 "try again").
  const orderId = isUuid(body.orderId) ? body.orderId : "";
  const off = body.off === true;
  if (!orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });

  type Row = { id: string; company: string | null; gallons: number | null; total_cents: number | null; payment_status: string | null; paylink_url: string | null; paylink_id: string | null; square_order_id: string | null; canceled_at: string | null };
  // scoped-by: tenant_id = the caller's own tenant; the id is the caller's to name only within it.
  const read = await supabaseAdmin.from("business_orders")
    .select("id, company, gallons, total_cents, payment_status, paylink_url, paylink_id, square_order_id, canceled_at")
    .eq("tenant_id", tenant).eq("id", orderId).maybeSingle();
  if (read.error) return NextResponse.json({ ok: false, error: "Couldn't read the order — try again." }, { status: 503 });
  const o = read.data as Row | null;
  if (!o) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  if (off) {
    // Paid another way: the link goes, so it cannot be paid a second time. Said back as off, none or unknown.
    const link = await switchOffPaylink(token, o);
    // scoped-by: the order just read in the caller's tenant
    // Off at Square and off on the order, or said not (R12b, F4): the order kept showing a link Square had switched off.
    if (link === "off") {
      const cleared = await supabaseAdmin.from("business_orders").update({ paylink_url: null, paylink_id: null }).eq("tenant_id", tenant).eq("id", o.id);
      if (cleared.error) return NextResponse.json({ ok: false, link, error: "The link is off at Square, but the order still shows it — try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: link !== "unknown", link });
  }
  if (o.canceled_at) return NextResponse.json({ ok: false, error: "order is canceled" }, { status: 400 });
  if (o.payment_status === "paid") return NextResponse.json({ ok: false, error: "already paid" }, { status: 400 });
  if (!o.total_cents || o.total_cents <= 0) return NextResponse.json({ ok: false, error: "order has no total" }, { status: 400 });
  if (o.paylink_url) return NextResponse.json({ ok: true, url: o.paylink_url });   // same order → same link

  const res = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: squareHeaders(token),
    signal: squareDeadline(),
    body: JSON.stringify({
      idempotency_key: safeIdemKey(`paylink-${o.id}`),
      quick_pay: {
        name: `GT3 office — ${o.company} · ${Math.round(o.gallons ?? 0)} gal`.slice(0, 255),
        price_money: { amount: o.total_cents, currency: "USD" },
        location_id: locationId,
      },
    }),
  });
  type LinkReply = { payment_link?: { id?: string; url?: string; order_id?: string }; errors?: { detail?: string }[] };
  const j = (await res.json().catch(() => ({}))) as LinkReply;
  const link = j.payment_link;
  if (!res.ok || !link?.url) {
    return NextResponse.json({ ok: false, error: j.errors?.[0]?.detail ?? "Square couldn't create the link" }, { status: 502 });
  }
  // The linkage IS the feature — if it doesn't save, the webhook can never auto-mark this order paid.
  // Fail loudly; the Square idempotency key means a retry returns the very same link.
  // scoped-by: the order just read in the caller's tenant
  const { error: linkErr } = await supabaseAdmin.from("business_orders")
    .update({ square_order_id: link.order_id ?? null, paylink_url: link.url, paylink_id: link.id ?? null })
    .eq("tenant_id", tenant).eq("id", o.id);
  if (linkErr) return NextResponse.json({ ok: false, error: "Link created but didn't save — tap again" }, { status: 502 });
  return NextResponse.json({ ok: true, url: link.url });
}

export const POST = route("office/paylink", post);
