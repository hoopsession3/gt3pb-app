import { NextResponse } from "next/server";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { SQUARE_BASE, SQUARE_VERSION } from "@/lib/squareServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { raiseAlert } from "@/lib/serverAlerts";

// Authoritative prices from Square Catalog; fall back to the locked catalog if unavailable.
async function priceMap(token: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, {
      headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
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
  // Paid orders are recorded server-side with the service role, so a client can never
  // forge a paid order (the orders RLS only allows paid=false inserts). Both are required.
  if (!token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Checkout isn't switched on yet." }, { status: 503 });
  }

  let body: { sourceId?: string; items?: DrinkId[]; tipCents?: number; customer?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const { sourceId, items, tipCents } = body;
  if (!sourceId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Empty order" }, { status: 400 });
  }
  if (items.length > 25) return NextResponse.json({ error: "Order too large" }, { status: 400 });

  // Availability is enforced HERE, not just on the screen: a stale cart or tampered client can't
  // buy an 86'd or delisted item. Checked before any charge. Missing product rows fail open (a
  // catalog gap must not brick checkout).
  {
    const uniq = [...new Set(items)];
    const { data: avail } = await supabaseAdmin.from("products").select("slug, sold_out, active").in("slug", uniq);
    const blocked = ((avail ?? []) as { slug: string; sold_out: boolean | null; active: boolean | null }[])
      .filter((p) => p.sold_out || p.active === false)
      .map((p) => DRINKS[p.slug as DrinkId]?.n ?? p.slug);
    if (blocked.length) {
      return NextResponse.json({ error: `${blocked.join(" · ")} just sold out — remove ${blocked.length === 1 ? "it" : "them"} and try again.` }, { status: 409 });
    }
  }

  // Server computes the authoritative goods subtotal (never trust a client amount).
  const prices = await priceMap(token);
  let subtotal = 0;
  for (const id of items) {
    if (!DRINKS[id]) return NextResponse.json({ error: `Unknown item: ${id}` }, { status: 400 });
    subtotal += prices[id] ?? Math.round(parseFloat(DRINKS[id].px.replace("$", "")) * 100);
  }
  // Tip is additive and capped at the subtotal as a fat-finger guard.
  const tip = typeof tipCents === "number" && Number.isFinite(tipCents) && tipCents > 0 ? Math.min(Math.round(tipCents), subtotal) : 0;
  const amount = subtotal + tip;

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
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
    const paymentId = data?.payment?.id ?? null;

    // Record the paid order server-side (paid + payment_id are trustworthy here).
    // total_cents is the GOODS subtotal (tip excluded) so history + the referral floor
    // are consistent across paid and pre-order paths.
    const user = await userFromRequest(req); // null for guest checkout
    const customer = typeof body.customer === "string" && body.customer.trim() ? body.customer.trim().slice(0, 80) : null;
    const orderRow = { items, total_cents: subtotal, paid: true, payment_id: paymentId, customer, user_id: user?.id ?? null, status: "new" };
    let { error: insErr } = await supabaseAdmin.from("orders").insert(orderRow);
    if (insErr) {
      // Charge succeeded but recording failed. Retry once — a transient DB blip must not cost the
      // customer their order record when their money is already taken.
      ({ error: insErr } = await supabaseAdmin.from("orders").insert(orderRow));
    }
    if (insErr) {
      // Still failed: alert the crew immediately with the payment id + items so they add it by hand,
      // and hand the customer a reference to show at the window. No more "just tell staff".
      const ref = (paymentId || "").slice(-6).toUpperCase();
      await raiseAlert({ severity: "critical", category: "money", title: "Paid order didn't record — add it", body: `A card payment succeeded (${paymentId}) but the order didn't save. ${customer ? `Name: ${customer}. ` : ""}Items: ${items.join(", ")}. Add it to the pass and confirm in Square.` });
      return NextResponse.json({ ok: true, paymentId, amount, recorded: false, ref, warn: `Payment received${ref ? ` — ref ${ref}` : ""}. We've alerted the crew to add your order; show this ref at the window.` }, { status: 200 });
    }
    return NextResponse.json({ ok: true, paymentId, amount, recorded: true });
  } catch {
    return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }
}
