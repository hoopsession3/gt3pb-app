import { NextResponse } from "next/server";
import { chargeCard, safeIdemKey } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";
import { notifyCustomer, accountEmail } from "@/lib/notify";
import { submitOrderToApliiq } from "@/lib/apliiq";

export const runtime = "nodejs";

// SHOP checkout (0273) — merch on the 0271 storefront spine, the same Square one-time-charge discipline
// as /api/reserve: the total is recomputed SERVER-SIDE from shop_products (never the client's number),
// the row is written with the service role so `paid` can't be forged, and the charge is deduped on the
// unique shop_orders.payment_id so a retried request can't double-charge. After the money is safely
// recorded we hand the order to Apliiq for print-on-demand fulfillment; if that call fails the order
// simply sits in the crew "needs fulfillment" queue — the customer's money is never lost to a POD hiccup.
type InItem = { product_id?: string; variant?: unknown; qty?: number };
type Ship = { name?: string; street?: string; city?: string; state?: string; zip?: string; email?: string };

export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!supabaseAdmin) return NextResponse.json({ error: "The shop isn't switched on yet." }, { status: 503 });

  let body: { sourceId?: string; idempotencyKey?: string; items?: InItem[]; ship?: Ship };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  if (!token || !locationId) return NextResponse.json({ error: "Card checkout isn't switched on yet." }, { status: 503 });
  if (!body.sourceId) return NextResponse.json({ error: "A card is required to check out." }, { status: 400 });

  // Guests can buy merch (unlike order-ahead) — but we need a shipping address + a contact email to send
  // tracking. A signed-in member's account email is used automatically; a guest supplies one.
  const user = await userFromRequest(req);
  const ship: Ship = body.ship ?? {};
  const shipName = String(ship.name ?? "").trim().slice(0, 90);
  const email = (user ? await accountEmail(user.id) : String(ship.email ?? "").trim().slice(0, 120)) || "";
  const addr = { street: String(ship.street ?? "").trim(), city: String(ship.city ?? "").trim(), state: String(ship.state ?? "").trim(), zip: String(ship.zip ?? "").trim() };
  if (!shipName || !addr.street || !addr.city || !addr.state || !addr.zip) {
    return NextResponse.json({ error: "A full shipping name and address are required." }, { status: 400 });
  }
  if (!email) return NextResponse.json({ error: "An email is required for your order + tracking." }, { status: 400 });

  // Rebuild the cart from trusted product ids only, and price it from the catalog.
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  const ids = [...new Set(rawItems.map((i) => String(i.product_id ?? "")).filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  const { data: prods, error: prodErr } = await supabaseAdmin.from("shop_products")
    .select("id, title, price_cents, cost_cents, apliiq_product_id, kind, published_at, archived_at")
    .in("id", ids).eq("kind", "merch");
  if (prodErr) return NextResponse.json({ error: "Couldn't price your cart." }, { status: 500 });
  const byId = new Map((prods ?? []).map((p) => [(p as { id: string }).id, p as Record<string, any>]));

  let subtotal = 0;
  const lineItems: { product_id: string; title: string; variant: unknown; qty: number; unit_cents: number; cost_cents: number | null; apliiq_product_id: string | null }[] = [];
  for (const it of rawItems) {
    const p = byId.get(String(it.product_id ?? ""));
    if (!p) continue;
    if (!p.published_at || p.archived_at) return NextResponse.json({ error: `"${p.title}" is no longer available.` }, { status: 409 });
    const qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty) || 1)));
    const unit = Math.max(0, Number(p.price_cents) || 0);
    subtotal += unit * qty;
    lineItems.push({ product_id: p.id, title: p.title, variant: it.variant ?? null, qty, unit_cents: unit, cost_cents: p.cost_cents ?? null, apliiq_product_id: p.apliiq_product_id ?? null });
  }
  if (lineItems.length === 0) return NextResponse.json({ error: "Nothing in your cart is available." }, { status: 409 });
  const total = subtotal; // shipping/tax can layer here later; POD ships flat via Apliiq for now
  if (total <= 0) return NextResponse.json({ error: "Cart total is $0 — nothing to charge." }, { status: 400 });

  const idemKey = safeIdemKey(body.idempotencyKey);
  try {
    const charge = await chargeCard({ token, locationId, sourceId: body.sourceId, amountCents: total, note: `GT3 shop · ${lineItems.reduce((n, l) => n + l.qty, 0)} item(s)`, idempotencyKey: idemKey, buyerEmail: email });
    if (!charge.ok) return NextResponse.json({ error: charge.error }, { status: 400 });
    const paymentId = charge.paymentId;
    // Dedupe at the order row — a retried request carries the same idempotency key, so Square returns
    // the same paymentId; the unique index on shop_orders.payment_id is the real backstop.
    if (paymentId) {
      const { data: already } = await supabaseAdmin.from("shop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
      if (already) return NextResponse.json({ ok: true, id: (already as { id: string }).id, paid: true, recorded: true });
    }

    const customerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user?.id ?? null, p_phone: null, p_email: email, p_name: shipName })).data as string | null;
    const orderRow = {
      customer_id: customerId, user_id: user?.id ?? null, email, payment_id: paymentId,
      subtotal_cents: subtotal, total_cents: total, ship_name: shipName, ship_address: addr, status: "needs_fulfillment",
    };
    let { data: order, error: insErr } = await supabaseAdmin.from("shop_orders").insert(orderRow).select("id").single();
    if (insErr) ({ data: order, error: insErr } = await supabaseAdmin.from("shop_orders").insert(orderRow).select("id").single()); // retry once
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505" && paymentId) {
        const dupe = await supabaseAdmin.from("shop_orders").select("id").eq("payment_id", paymentId).maybeSingle();
        if (dupe.data) return NextResponse.json({ ok: true, id: (dupe.data as { id: string }).id, paid: true, recorded: true });
      }
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", kind: "ops_incident", title: "Paid shop order didn't record — add it", body: `A card payment succeeded (${paymentId}) but the shop order didn't save. ${shipName} · ${lineItems.map((l) => `${l.qty}× ${l.title}`).join(", ")}. Confirm in Square and add it.` });
      return NextResponse.json({ ok: true, paid: true, recorded: false, ref, warn: `Paid — ref ${ref}. We've alerted the crew; we'll follow up by email.` });
    }
    const orderId = (order as { id: string }).id;
    await supabaseAdmin.from("shop_order_items").insert(
      lineItems.map((l) => ({ order_id: orderId, product_id: l.product_id, title: l.title, variant: l.variant, qty: l.qty, unit_cents: l.unit_cents, cost_cents: l.cost_cents }))
    );

    // Hand the paid order to Apliiq for print-on-demand. Best-effort: a failure leaves the order in the
    // crew "needs fulfillment" queue (money already collected), never blocks the customer's confirmation.
    try {
      const submit = await submitOrderToApliiq({
        id: orderId,
        ship: { name: shipName, street: addr.street, city: addr.city, state: addr.state, zip: addr.zip },
        items: lineItems.filter((l) => l.apliiq_product_id).map((l) => ({ apliiq_product_id: l.apliiq_product_id, variant: l.variant, qty: l.qty })),
      });
      if (submit.ok) {
        await supabaseAdmin.from("shop_orders").update({ apliiq_order_id: submit.apliiqOrderId, status: "submitted", updated_at: new Date().toISOString() }).eq("id", orderId);
      } else {
        await raiseAlert({ severity: "important", category: "order", kind: "fulfillment", subjectId: orderId, title: "Shop order needs manual fulfillment", body: `Apliiq submit failed (${submit.error}) for ${shipName}'s order. It's paid and queued — submit it by hand.` });
      }
    } catch { /* keep the confirmation clean; the order is safely 'needs_fulfillment' */ }

    try {
      await notifyCustomer({ email, subject: "Your GT3 order is in", message: `Thanks ${shipName.split(" ")[0] || ""}! We got your order — ${lineItems.map((l) => `${l.qty}× ${l.title}`).join(", ")}. We'll email tracking the moment it ships.` });
    } catch { /* notify is best-effort */ }
    await raiseAlert({ severity: "fyi", category: "order", kind: "shop_order_new", subjectId: orderId, title: "New shop order 🧢", body: `${shipName} — ${lineItems.map((l) => `${l.qty}× ${l.title}`).join(", ")} · $${(total / 100).toFixed(2)}.` });
    return NextResponse.json({ ok: true, id: orderId, paid: true, recorded: true });
  } catch {
    return NextResponse.json({ error: "Checkout service unavailable" }, { status: 502 });
  }
}
