import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, tenantFromRequest, userFromRequest } from "@/lib/apiAuth";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { orderReceipt } from "@/lib/receipt";

export const runtime = "nodejs";

// SEND A CUSTOMER THEIR RECEIPT AGAIN.
//
// The first cap order was charged, printed and never emailed (2026-09-29), and the only recovery
// was for Ryan to write the customer an email by hand — from memory of what they bought, with no
// record that he had done it. This is that, done properly:
//
//   · The wording is rebuilt from the ORDER ROW, through lib/receipt, so it is the same receipt
//     the checkout sends. Not a retyped approximation, and not a second version that disagrees.
//   · It is recorded in customer_messages with the id of the person who pressed the button, so
//     "why did they get two receipts" has an answer.
//   · It hands back the provider's verdict, so a failure says why instead of going quiet — which
//     is the whole reason this order went unnoticed in the first place.
//
// Nothing about the order changes. This does not alter status, does not touch money, and can be
// pressed twice without consequence beyond the customer having two copies — which is the point.
export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // R-002: staff-gated, so any crew member may act on any order — within THEIR tenant.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });

  let id = "", to = "";
  try { ({ id = "", to = "" } = await req.json()); } catch { /* */ }
  if (!id) return NextResponse.json({ ok: false, error: "order id required" }, { status: 400 });

  const { data: order } = await supabaseAdmin
    .from("shop_orders")
    .select("id, email, user_id, ship_name, total_cents, status")
    .eq("tenant_id", tenant).eq("id", id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const { data: items } = await supabaseAdmin
    .from("shop_order_items").select("title, qty, unit_cents").eq("order_id", id);

  // Tracking, when the printer has already shipped it — a receipt sent after the fact that still
  // says "we'll email tracking when it ships" is worse than useless to somebody waiting on a box.
  const { data: ship } = await supabaseAdmin
    .from("merch_fulfillments").select("tracking_number, tracking_url")
    .eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  // An operator may correct a bad address here — a typo in the email is one of the two ways a
  // receipt fails to arrive, and the other one is the provider. The corrected address is recorded
  // on the message, not written back over the order, because the order is what the customer typed.
  const address = String(to || "").trim() ||
    (order as { email?: string | null }).email ||
    (await accountEmail((order as { user_id?: string | null }).user_id ?? null)) || "";
  if (!address.includes("@")) {
    return NextResponse.json({ ok: false, error: "no email address on this order — type one to send to" }, { status: 400 });
  }

  const me = await userFromRequest(req);
  const body = orderReceipt({
    id: order.id,
    ship_name: (order as { ship_name?: string | null }).ship_name,
    total_cents: (order as { total_cents?: number | null }).total_cents,
    items: (items ?? []) as { title: string; qty: number; unit_cents?: number | null }[],
    tracking_number: (ship as { tracking_number?: string | null } | null)?.tracking_number ?? null,
    tracking_url: (ship as { tracking_url?: string | null } | null)?.tracking_url ?? null,
  }, true);

  const sent = await tellCustomer({
    orderId: order.id, email: address, kind: "receipt_resend", sentBy: me?.id ?? null, ...body,
  });

  return NextResponse.json({ ok: true, sent: sent.ok, to: address, detail: sent.detail ?? null, result: sent.email });
}
