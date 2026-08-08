import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyApliiq, firstSeen } from "@/lib/apliiq";
import { notifyCustomer, accountEmail } from "@/lib/notify";

export const runtime = "nodejs";

// APLIIQ → us: "fulfillment" (0271). When Apliiq ships an order it POSTs the tracking here. Verified
// by HMAC, idempotent by event id: write the fulfillment, flip the order to shipped, and fire the
// customer's "it's on the way" note through the existing notify engine. Defensive throughout.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyApliiq(raw, req.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });

  let p: any;
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  // Match our order by the external_id we sent Apliiq, or by their order id if that's all they echo.
  const externalId = String(p?.external_id ?? p?.externalId ?? "").trim();
  const apliiqOrderId = String(p?.OrderId ?? p?.order_id ?? p?.Id ?? "").trim();
  const tracking = String(p?.TrackingNumber ?? p?.tracking_number ?? p?.tracking ?? "").trim();

  const eventId = req.headers.get("x-apliiq-delivery") || `fulfil:${externalId || apliiqOrderId}:${tracking}`;
  if (!(await firstSeen("apliiq", eventId))) return NextResponse.json({ ok: true, deduped: true });

  const { data: order } = await supabaseAdmin.from("shop_orders")
    .select("id, user_id, email")
    .or(`id.eq.${externalId || "00000000-0000-0000-0000-000000000000"},apliiq_order_id.eq.${apliiqOrderId || "___none___"}`)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });

  const trackingUrl = p?.TrackingUrl ?? p?.tracking_url ?? (tracking ? `https://google.com/search?q=${encodeURIComponent(tracking)}` : null);
  await supabaseAdmin.from("merch_fulfillments").insert({
    order_id: (order as any).id, carrier: p?.Carrier ?? p?.carrier ?? null,
    tracking_number: tracking || null, tracking_url: trackingUrl, shipped_at: new Date().toISOString(),
  });
  await supabaseAdmin.from("shop_orders").update({ status: "shipped", updated_at: new Date().toISOString() }).eq("id", (order as any).id);

  try {
    const email = (order as any).email || (await accountEmail((order as any).user_id ?? null));
    if (email) {
      await notifyCustomer({
        email,
        subject: "Your GT3 order shipped",
        message: `Good news — your order is on the way.${tracking ? ` Tracking: ${tracking}` : ""}${trackingUrl ? `\n${trackingUrl}` : ""}`,
      });
    }
  } catch { /* notify is best-effort; the ship status is already recorded */ }
  return NextResponse.json({ ok: true });
}
