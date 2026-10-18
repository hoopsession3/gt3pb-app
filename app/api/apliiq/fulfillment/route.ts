import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { TablesUpdate } from "@/lib/database.types";
import { verifyApliiq, firstSeen, forgetSeen } from "@/lib/apliiq";
import { accountEmail } from "@/lib/notify";
import { tellCustomer } from "@/lib/customerMessage";
import { shippedNotice } from "@/lib/receipt";
import { integrationTenant } from "@/lib/tenantScope";
import { raiseAlertOnce } from "@/lib/serverAlerts";
import { isUuid } from "@/lib/uuid";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

/** An Apliiq order id as it may be looked up: letters, digits and a few joiners, never a filter's punctuation. */
const APLIIQ_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

type Found = { id: string; user_id: string | null; email: string | null; status: string; apliiq_order_id: string | null };

// APLIIQ → us: "fulfillment" (0271). When Apliiq ships an order it POSTs the tracking here. Verified
// by HMAC, idempotent by event id: write the fulfillment, flip the order to shipped, and fire the
// customer's "it's on the way" note through the existing notify engine. Defensive throughout.
//
// R9 (2026-10-16 — the money audit's A10, and 0417's unclear send):
//   · The order is found by our id or by Apliiq's, each checked for its shape and asked in its own query. The two were
//     pasted into one PostgREST filter string, so a value carrying a comma or a bracket rewrote the filter.
//   · The inbox key is the order found and the tracking number, read from the signed body — never x-apliiq-delivery, a
//     header outside the signature: a captured call sent again with a new one shipped (and emailed) the order again.
//   · A send that got no clear answer (0417) is answered here: the order is at the printer. Apliiq's id is kept when
//     the order had none, and the "no clear answer" mark comes off.
//   · An order already delivered is not walked back to shipped; one refunded or canceled keeps its status (0313's
//     guard notes the report) and the crew is told the printer shipped it anyway.
//   · An order not found is said to the crew, once — a send that never got Apliiq's id is matched by hand, on the order.
async function post(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  // R-002: no session here (see lib/tenantScope for why this one can never have a bearer), so the
  // scope is the tenant that owns this deployment's integrations and storefront — the same uuid
  // 0134's stamp_tenant() writes for every guest row. Stated, not assumed.
  const tenant = integrationTenant();

  let p: Record<string, unknown> | null;
  try { p = JSON.parse(raw) as Record<string, unknown> | null; } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  // Our id is the one we sent Apliiq (lib/apliiqOrder: id, order_number); theirs is the id their API gave back.
  const external = text(p?.external_id ?? p?.externalId ?? p?.order_number);
  const named = text(p?.OrderId ?? p?.order_id ?? p?.Id);
  const ourId = isUuid(external) ? external.toLowerCase() : isUuid(named) ? named.toLowerCase() : "";
  const theirId = !isUuid(named) && APLIIQ_ID.test(named) ? named : "";
  const tracking = text(p?.TrackingNumber ?? p?.tracking_number ?? p?.tracking).slice(0, 120);
  if (!ourId && !theirId) return NextResponse.json({ ok: false, error: "no order named" }, { status: 400 });

  const cols = "id, user_id, email, status, apliiq_order_id";
  let order: Found | null = null;
  if (ourId) {
    // scoped-by: tenant_id = this deployment's storefront tenant, and the id is a uuid read from the signed body.
    const r = await supabaseAdmin.from("shop_orders").select(cols).eq("tenant_id", tenant).eq("id", ourId).maybeSingle();
    if (r.error) return NextResponse.json({ ok: false, error: "couldn't look — send it again" }, { status: 503 });
    order = (r.data as Found | null) ?? null;
  }
  if (!order && theirId) {
    // The apliiq key on shop_orders is NOT unique (checked in production), unlike payment_id — so this one needs the
    // scope, and two orders under one Apliiq id are said, never guessed between.
    // scoped-by: tenant_id = this deployment's storefront tenant, and the id is checked for its shape above.
    const r = await supabaseAdmin.from("shop_orders").select(cols).eq("tenant_id", tenant).eq("apliiq_order_id", theirId).limit(2);
    if (r.error) return NextResponse.json({ ok: false, error: "couldn't look — send it again" }, { status: 503 });
    const rows = (r.data ?? []) as Found[];
    if (rows.length > 1) {
      await raiseAlertOnce({
        severity: "important", category: "order", kind: "printer_unmatched", subjectId: `apliiq:${theirId}`,
        title: "The printer shipped an order two of ours claim",
        body: `Apliiq shipped its order ${theirId}${tracking ? ` (tracking ${tracking})` : ""}, and two shop orders here carry that id. Find the right one in Apliiq and correct the other — the shipping update waits until then.`,
        link: "/crew?s=catalog&a=shoporders",
      });
      return NextResponse.json({ ok: false, error: "two orders carry that id" }, { status: 409 });
    }
    order = rows[0] ?? null;
  }
  // NOT FOUND: answered so Apliiq sends it again (nothing was marked seen), and the crew is told once — an order whose
  // send got no clear answer has no Apliiq id until someone says it on the order, and then the next try finds it.
  if (!order) {
    await raiseAlertOnce({
      severity: "important", category: "order", kind: "printer_unmatched", subjectId: `apliiq:${theirId || ourId}`,
      title: "The printer shipped an order we can't match",
      body: `Apliiq sent tracking${tracking ? ` ${tracking}` : ""} for ${theirId ? `its order ${theirId}` : `order ${ourId.slice(0, 8)}`}, and no shop order here carries it. If an order is waiting on a check in Apliiq, say there it's at Apliiq${theirId ? ` as ${theirId}` : ""} — the next update then lands on it.`,
      link: "/crew?s=catalog&a=shoporders",
    });
    return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  }

  // Once per order and tracking number, from the signed body — so a retry after a half-done first try adds no second
  // shipment, and the same call sent again is answered "deduped".
  const eventId = `fulfil:${order.id}:${tracking}`;
  if (!(await firstSeen("apliiq", eventId))) return NextResponse.json({ ok: true, deduped: true });

  // A web address or none: it is a link in the customer's email.
  const givenUrl = text(p?.TrackingUrl ?? p?.tracking_url);
  const trackingUrl = /^https?:\/\/\S+$/i.test(givenUrl) ? givenUrl.slice(0, 500) : tracking ? `https://google.com/search?q=${encodeURIComponent(tracking)}` : null;
  const orderId = order.id;
  // NOT DONE IS NOT SEEN (R8): a write that failed gives the event back, and answers so Apliiq sends it again.
  // scoped-by: orderId came from the shop_orders lookup above, which filters on tenant_id
  const had = tracking
    ? await supabaseAdmin.from("merch_fulfillments").select("id").eq("order_id", orderId).eq("tracking_number", tracking).limit(1)
    : await supabaseAdmin.from("merch_fulfillments").select("id").eq("order_id", orderId).limit(1);
  const fulfilled = had.error ? had : (had.data ?? []).length ? { error: null } : await supabaseAdmin.from("merch_fulfillments").insert({
    order_id: orderId, carrier: text(p?.Carrier ?? p?.carrier).slice(0, 60) || null,
    tracking_number: tracking || null, tracking_url: trackingUrl, shipped_at: new Date().toISOString(),
  });
  // Shipped — never walked back from delivered. At the printer, so no send is waiting on a check any more; Apliiq's id
  // is kept when the order had none.
  const patch: TablesUpdate<"shop_orders"> = { updated_at: new Date().toISOString(), apliiq_submit_unknown_at: null, apliiq_submit_started_at: null };
  if (order.status !== "delivered") patch.status = "shipped";
  if (!order.apliiq_order_id && theirId) patch.apliiq_order_id = theirId;
  // scoped-by: orderId came from the shop_orders lookup above, which filters on tenant_id
  const shipped = fulfilled.error ? fulfilled : await supabaseAdmin.from("shop_orders").update(patch).eq("id", orderId);
  if (fulfilled.error || shipped.error) { await forgetSeen("apliiq", eventId); return NextResponse.json({ ok: false, error: "not recorded — send it again" }, { status: 500 }); }

  if (order.status === "refunded" || order.status === "canceled") {
    await raiseAlertOnce({
      severity: "important", category: "money", kind: "printer_shipped_closed", subjectId: orderId,
      title: "The printer shipped an order we'd closed",
      body: `Apliiq shipped an order that is ${order.status} here${tracking ? ` (tracking ${tracking})` : ""}. The customer is getting it anyway — the order keeps its status, and the tracking is on it.`,
      link: "/crew?s=catalog&a=shoporders",
    });
  }

  try {
    const o = order;
    const email = o.email || (await accountEmail(o.user_id ?? null));
    if (email) {
      // The payload's ids were INPUTS to that scoped query, never the key used here — so a forged id cannot reach
      // another tenant's rows even before the HMAC is considered.
      //
      // scoped-by: o.id came from the shop_orders lookup above, which filters on tenant_id
      const { data: items } = await supabaseAdmin
        .from("shop_order_items").select("title, qty").eq("order_id", o.id);
      await tellCustomer({
        orderId: o.id,
        email,
        kind: "shipped",
        // Once per shipment (R22, lib/notify onceKey): Apliiq tells its webhook again on a retry; the customer hears once.
        key: `shipped:${o.id}:${tracking || "no-tracking"}`,
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
