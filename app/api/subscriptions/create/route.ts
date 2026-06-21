import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders, SQUARE_PLAN_VARIATION_ID, subsConfigured, mapSubStatus } from "@/lib/squareServer";

// Create a recurring subscription: ensure a Square Customer, vault the card,
// then CreateSubscription against the owner's plan variation. Square owns billing;
// we write an initial mirror row (the webhook keeps it authoritative thereafter).
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!subsConfigured() || !token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Subscriptions aren't switched on yet." }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to subscribe." }, { status: 401 });

  let body: { sourceId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body.sourceId) return NextResponse.json({ error: "Card required" }, { status: 400 });

  // already subscribed? (don't double-bill)
  const { data: existing } = await supabaseAdmin
    .from("subscriptions").select("id").eq("user_id", user.id).in("status", ["active", "paused", "pending"]).maybeSingle();
  if (existing) return NextResponse.json({ error: "You already have a subscription." }, { status: 409 });

  const { data: prof } = await supabaseAdmin.from("profiles").select("display_name, square_customer_id").eq("id", user.id).maybeSingle();
  const { data: au } = await supabaseAdmin.auth.admin.getUserById(user.id);
  const email = au?.user?.email ?? undefined;

  try {
    // 1) ensure a Square Customer (persist the id so we never orphan one)
    let customerId = prof?.square_customer_id || "";
    if (!customerId) {
      const cRes = await fetch(`${SQUARE_BASE}/v2/customers`, {
        method: "POST", headers: squareHeaders(token),
        body: JSON.stringify({ idempotency_key: `cust-${user.id}`, given_name: prof?.display_name || undefined, email_address: email }),
      });
      const cData = await cRes.json();
      if (!cRes.ok) return NextResponse.json({ error: cData?.errors?.[0]?.detail || "Couldn't set up billing" }, { status: 400 });
      customerId = cData?.customer?.id;
      await supabaseAdmin.from("profiles").update({ square_customer_id: customerId }).eq("id", user.id);
    }

    // 2) vault the card on file
    const cardRes = await fetch(`${SQUARE_BASE}/v2/cards`, {
      method: "POST", headers: squareHeaders(token),
      body: JSON.stringify({ idempotency_key: `card-${user.id}-${Date.now()}`, source_id: body.sourceId, card: { customer_id: customerId } }),
    });
    const cardData = await cardRes.json();
    if (!cardRes.ok) return NextResponse.json({ error: cardData?.errors?.[0]?.detail || "Card couldn't be saved" }, { status: 400 });
    const cardId = cardData?.card?.id;

    // 3) create the subscription
    const subRes = await fetch(`${SQUARE_BASE}/v2/subscriptions`, {
      method: "POST", headers: squareHeaders(token),
      body: JSON.stringify({
        idempotency_key: `sub-${user.id}-${Date.now()}`,
        location_id: locationId,
        plan_variation_id: SQUARE_PLAN_VARIATION_ID,
        customer_id: customerId,
        card_id: cardId,
      }),
    });
    const subData = await subRes.json();
    if (!subRes.ok) return NextResponse.json({ error: subData?.errors?.[0]?.detail || "Subscription couldn't start" }, { status: 400 });
    const sub = subData?.subscription;

    // 4) initial mirror (webhook reconciles authoritatively)
    await supabaseAdmin.from("subscriptions").upsert({
      user_id: user.id,
      square_subscription_id: sub?.id,
      plan: "rise_flow",
      status: mapSubStatus(sub?.status),
      square_card_id: cardId,
      current_period_end: sub?.charged_through_date || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "square_subscription_id" });

    return NextResponse.json({ ok: true, status: mapSubStatus(sub?.status) });
  } catch {
    return NextResponse.json({ error: "Subscription service unavailable" }, { status: 502 });
  }
}
