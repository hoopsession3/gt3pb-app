import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { userFromRequest } from "@/lib/apiAuth";
import { SQUARE_BASE, squareHeaders, planForPack, subsConfigured, mapSubStatus } from "@/lib/squareServer";
import { raiseAlert } from "@/lib/serverAlerts";

// Create a recurring subscription: ensure a Square Customer, vault the card, then
// CreateSubscription against the owner's plan variation. Square owns billing; we keep
// a status mirror (the webhook keeps it authoritative).
export async function POST(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;
  if (!subsConfigured() || !token || !locationId || !supabaseAdmin) {
    return NextResponse.json({ error: "Subscriptions aren't switched on yet." }, { status: 503 });
  }
  // Owner's go-live switch (0150): even with Square configured, subscriptions stay dark until the
  // owner flips subscriptions_enabled on (Money → Payments). Server-side authority, not just UI.
  const { data: ls } = await supabaseAdmin.from("live_status").select("subscriptions_enabled").maybeSingle();
  if ((ls as { subscriptions_enabled?: boolean } | null)?.subscriptions_enabled !== true) {
    return NextResponse.json({ error: "Subscriptions aren't available yet." }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in to subscribe." }, { status: 401 });

  let body: { sourceId?: string; pack?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body.sourceId) return NextResponse.json({ error: "Card required" }, { status: 400 });
  const pack = String(body.pack || "");
  const planId = planForPack(pack);
  if (!["6", "12", "18"].includes(pack) || !planId) return NextResponse.json({ error: "Choose a pack size (6, 12, or 18)." }, { status: 400 });

  // Self-heal: clear the caller's own stale 'pending' rows that never reached Square
  // (a prior attempt that died before vaulting the card). Only rows older than 10 min
  // and with no Square id, so a genuinely concurrent in-flight attempt still trips the
  // double-subscribe guard below. Without this, one dead attempt locks the member out
  // of subscribing forever (the partial unique index keeps rejecting them).
  await supabaseAdmin
    .from("subscriptions").delete()
    .eq("user_id", user.id).eq("status", "pending").is("square_subscription_id", null)
    .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Atomic double-subscribe guard: claim a 'pending' row BEFORE calling Square. The
  // partial unique index subscriptions_one_active(user_id) rejects a concurrent or
  // existing active/paused/pending/past_due subscription, so only one request ever
  // reaches Square — no duplicate billable subscriptions.
  // Canonical customer link (0151), so a subscription counts toward the same person as their orders.
  const canonCustomerId = (await supabaseAdmin.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: null })).data as string | null;
  const { data: pending, error: claimErr } = await supabaseAdmin
    .from("subscriptions").insert({ user_id: user.id, customer_id: canonCustomerId, plan: `coffee_${pack}`, status: "pending" }).select("id").single();
  if (claimErr || !pending) {
    return NextResponse.json({ error: "You already have a subscription." }, { status: 409 });
  }
  const rowId = pending.id as string;
  // Tracks whether a LIVE Square subscription exists for this attempt. Once it does, we must never
  // delete the mirror row — that would orphan a billing subscription the member can't cancel in-app.
  let squareSubId: string | null = null;

  try {
    const { data: prof } = await supabaseAdmin.from("profiles").select("display_name, square_customer_id").eq("id", user.id).maybeSingle();
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const email = au?.user?.email ?? undefined;

    // 1) ensure a Square Customer (persist so we never orphan one)
    let customerId = prof?.square_customer_id || "";
    if (!customerId) {
      const cRes = await fetch(`${SQUARE_BASE}/v2/customers`, {
        method: "POST", headers: squareHeaders(token),
        body: JSON.stringify({ idempotency_key: `cust-${user.id}`, given_name: prof?.display_name || undefined, email_address: email }),
      });
      const cData = await cRes.json();
      if (!cRes.ok) throw new Error(cData?.errors?.[0]?.detail || "Couldn't set up billing");
      customerId = cData?.customer?.id;
      await supabaseAdmin.from("profiles").update({ square_customer_id: customerId }).eq("id", user.id);
    }

    // 2) vault the card (idempotency keyed to this attempt's row → retries dedupe, resubscribe doesn't)
    const cardRes = await fetch(`${SQUARE_BASE}/v2/cards`, {
      method: "POST", headers: squareHeaders(token),
      body: JSON.stringify({ idempotency_key: `card-${rowId}`, source_id: body.sourceId, card: { customer_id: customerId } }),
    });
    const cardData = await cardRes.json();
    if (!cardRes.ok) throw new Error(cardData?.errors?.[0]?.detail || "Card couldn't be saved");
    const cardId = cardData?.card?.id;

    // 3) create the subscription
    const subRes = await fetch(`${SQUARE_BASE}/v2/subscriptions`, {
      method: "POST", headers: squareHeaders(token),
      body: JSON.stringify({ idempotency_key: `sub-${rowId}`, location_id: locationId, plan_variation_id: planId, customer_id: customerId, card_id: cardId }),
    });
    const subData = await subRes.json();
    if (!subRes.ok) throw new Error(subData?.errors?.[0]?.detail || "Subscription couldn't start");
    const sub = subData?.subscription;
    squareSubId = sub?.id ?? null;

    // Persist the Square id to the mirror IMMEDIATELY — before anything else can throw — so the row
    // can never be orphaned: the member can always cancel, and the webhook can always match by id.
    if (squareSubId) await supabaseAdmin.from("subscriptions").update({ square_subscription_id: squareSubId }).eq("id", rowId);

    // 4) fill the rest of the mirror (webhook reconciles authoritatively)
    await supabaseAdmin.from("subscriptions").update({
      status: mapSubStatus(sub?.status),
      square_card_id: cardId,
      current_period_end: sub?.charged_through_date || null,
      updated_at: new Date().toISOString(),
    }).eq("id", rowId);

    // Leadership visibility — new recurring revenue shouldn't be invisible.
    await raiseAlert({ severity: "fyi", category: "note", title: "New subscriber 🎉", body: `A member started a ${pack}-pack coffee subscription. See Subscribers.` });
    return NextResponse.json({ ok: true, status: mapSubStatus(sub?.status) });
  } catch (e) {
    if (squareSubId) {
      // A Square subscription is LIVE. Deleting the mirror would orphan a billing subscription the
      // member could never cancel in-app. Keep the row, ensure it carries the id, mark it active,
      // and flag staff to reconcile — never silently drop a paying member.
      await supabaseAdmin.from("subscriptions").update({ status: "active", square_subscription_id: squareSubId, updated_at: new Date().toISOString() }).eq("id", rowId);
      await raiseAlert({ severity: "critical", category: "money", title: "Subscription needs reconcile", body: `A subscription is live at Square (${squareSubId}) but setup errored after billing started. It's kept so the member can cancel — verify the mirror in Subscribers.` });
      return NextResponse.json({ ok: true, status: "active", warn: "You're subscribed — we're finalizing a couple details." });
    }
    // Nothing was created at Square — safe to roll back the pending claim so the member can retry.
    await supabaseAdmin.from("subscriptions").delete().eq("id", rowId);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Subscription couldn't start" }, { status: 400 });
  }
}
