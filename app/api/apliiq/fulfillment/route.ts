import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyApliiq, firstSeen, forgetSeen } from "@/lib/apliiq";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { shippedNotice } from "@/lib/receipt";
import { integrationTenant } from "@/lib/tenantScope";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// APLIIQ → us: "fulfillment" (0271). When Apliiq ships an order it POSTs the tracking here. Verified
// by HMAC, idempotent by event id: write the fulfillment, flip the order to shipped, and fire the
// customer's "it's on the way" note through the existing notify engine. Defensive throughout.
async function post(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  // R-002: no session here (see lib/tenantScope for why this one can never have a bearer), so the
  // scope is the tenant that owns this deployment's integrations and storefront — the same uuid
  // 0134's stamp_tenant() writes for every guest row. Stated, not assumed.
  const tenant = integrationTenant();


  let p: any;
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  // Match our order by the external_id we sent Apliiq, or by their order id if that's all they echo.
  const externalId = String(p?.external_id ?? p?.externalId ?? "").trim();
  const apliiqOrderId = String(p?.OrderId ?? p?.order_id ?? p?.Id ?? "").trim();
  const tracking = String(p?.TrackingNumber ?? p?.tracking_number ?? p?.tracking ?? "").trim();

  const eventId = req.headers.get("x-apliiq-delivery") || `fulfil:${externalId || apliiqOrderId}:${tracking}`;
  if (!(await firstSeen("apliiq", eventId))) return NextResponse.json({ ok: true, deduped: true });

  // The apliiq key on shop_orders is NOT unique (checked in production), unlike payment_id —
  // so unlike the dedupe lookups this one cannot stand on its key alone and needs the scope.
  const { data: order } = await supabaseAdmin.from("shop_orders")
    .select("id, user_id, email").eq("tenant_id", tenant)
    .or(`id.eq.${externalId || "00000000-0000-0000-0000-000000000000"},apliiq_order_id.eq.${apliiqOrderId || "___none___"}`)
    .maybeSingle();
  // NOT DONE IS NOT SEEN (R8): the event was marked seen as it arrived, so an order not found yet, or a write that failed,
  // answered every retry "deduped" — the order never read shipped and the customer never had the tracking. Each of those
  // gives the event back, and answers so Apliiq sends it again.
  if (!order) { await forgetSeen("apliiq", eventId); return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 }); }

  const trackingUrl = p?.TrackingUrl ?? p?.tracking_url ?? (tracking ? `https://google.com/search?q=${encodeURIComponent(tracking)}` : null);
  const orderId = (order as { id: string }).id;
  // Once per order and tracking number, so a retry after a half-done first try adds no second shipment.
  // scoped-by: orderId came from the shop_orders lookup above, which filters on tenant_id
  const had = tracking
    ? await supabaseAdmin.from("merch_fulfillments").select("id").eq("order_id", orderId).eq("tracking_number", tracking).limit(1)
    : await supabaseAdmin.from("merch_fulfillments").select("id").eq("order_id", orderId).limit(1);
  const fulfilled = had.error ? had : (had.data ?? []).length ? { error: null } : await supabaseAdmin.from("merch_fulfillments").insert({
    order_id: orderId, carrier: p?.Carrier ?? p?.carrier ?? null,
    tracking_number: tracking || null, tracking_url: trackingUrl, shipped_at: new Date().toISOString(),
  });
  // scoped-by: orderId came from the shop_orders lookup above, which filters on tenant_id
  const shipped = fulfilled.error ? fulfilled : await supabaseAdmin.from("shop_orders").update({ status: "shipped", updated_at: new Date().toISOString() }).eq("id", orderId);
  if (fulfilled.error || shipped.error) { await forgetSeen("apliiq", eventId); return NextResponse.json({ ok: false, error: "not recorded — send it again" }, { status: 500 }); }

  try {
    // Named once rather than cast at each use. The casts above this line predate me and are left
    // alone; the three I would otherwise have ADDED are the three I am responsible for.
    const o = order as { id: string; email?: string | null; user_id?: string | null };
    const email = o.email || (await accountEmail(o.user_id ?? null));
    if (email) {
      // The payload's external_id was an INPUT to that scoped query, never the key used here — so a
      // forged id cannot reach another tenant's rows even before the HMAC is considered.
      //
      // scoped-by: o.id came from the shop_orders lookup above, which filters on tenant_id
      const { data: items } = await supabaseAdmin
        .from("shop_order_items").select("title, qty").eq("order_id", o.id);
      await tellCustomer({
        orderId: o.id,
        email,
        kind: "shipped",
        ...shippedNotice({
          id: o.id,
          items: (items ?? []) as { title: string; qty: number }[],
          tracking_number: tracking || null,
          tracking_url: trackingUrl,
        }),
      });
    }
  } catch { /* notify is best-effort; the ship status is already recorded */ }
  return NextResponse.json({ ok: true });
}

export const POST = route("apliiq/fulfillment", post);
