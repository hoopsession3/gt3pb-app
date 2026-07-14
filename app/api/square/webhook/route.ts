import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, mapSubStatus } from "@/lib/squareServer";
import { raiseAlert } from "@/lib/serverAlerts";

export const runtime = "nodejs"; // needs node crypto + raw body

/* eslint-disable @typescript-eslint/no-explicit-any */
// Square subscription/invoice webhook. Verifies the HMAC over the raw body BEFORE
// any DB write, then updates the read-only mirror via the service role. The mirror
// row is created by /api/subscriptions/create (which knows the user_id); this only
// updates existing rows by square_subscription_id, so forged events can't grant access.
export async function POST(req: Request) {
  // SQUARE_WEBHOOK_URL must be set and EXACTLY match the endpoint registered in Square,
  // because the HMAC is computed over (notificationUrl + rawBody). No req.url fallback —
  // behind a proxy that won't match and would silently reject every event.
  if (!supabaseAdmin || !SQUARE_WEBHOOK_SIGNATURE_KEY || !SQUARE_WEBHOOK_URL) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("x-square-hmacsha256-signature") || "";
  const expected = crypto.createHmac("sha256", SQUARE_WEBHOOK_SIGNATURE_KEY).update(SQUARE_WEBHOOK_URL + raw).digest("base64");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const type: string = evt?.type || "";

  try {
    let err: { message?: string } | null = null;
    if (type.startsWith("subscription.")) {
      const sub = evt?.data?.object?.subscription;
      if (sub?.id) {
        const next = mapSubStatus(sub.status);
        let q = supabaseAdmin.from("subscriptions").update({
          status: next,
          current_period_end: sub.charged_through_date || null,
          updated_at: new Date().toISOString(),
        }).eq("square_subscription_id", sub.id);
        // 'canceled' is terminal (the member's intent) and 'past_due' clears only on a real
        // payment — so a stale 'subscription.updated' ACTIVE must not revive either back to active.
        // Other transitions (canceled/paused) still apply.
        if (next === "active") q = q.not("status", "in", "(canceled,past_due)");
        ({ error: err } = await q);
        // Leadership visibility on churn — a cancel shouldn't be invisible.
        if (next === "canceled") await raiseAlert({ severity: "important", category: "money", title: "Subscription canceled", body: "A member canceled their coffee subscription. See Subscribers." });
      }
    } else if (type === "invoice.payment_made") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      // A payment clears past_due back to active, but must never resurrect a canceled subscription.
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "active", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId).neq("status", "canceled"));
    } else if (type === "invoice.payment_failed") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId));
      // Producer: a failed payment is a money problem leadership should see fast.
      await raiseAlert({ severity: "critical", category: "money", title: "Subscription payment failed", body: "A subscriber's card was declined — they'll lose access. Check Subscribers." });
    } else if (type.startsWith("payment.")) {
      // Mirror completed Square sales (incl. walk-up POS that never touch the app) into
      // event_sales, scoped to the live event, so the command center HUD is real. Dedupe
      // by payment id (Square retries). Needs the "Payment" event subscribed in Square.
      const p = evt?.data?.object?.payment;
      if (p?.id && p?.status === "COMPLETED") {
        const { data: liveEv } = await supabaseAdmin.from("events").select("id").eq("is_live", true).maybeSingle();
        ({ error: err } = await supabaseAdmin.from("event_sales").upsert({
          square_payment_id: p.id,
          event_id: liveEv?.id ?? null,
          source: "square",
          amount_cents: p?.amount_money?.amount ?? 0,
        }, { onConflict: "square_payment_id" }));
        // An office payment link paid → auto-mark the business order + store the payment id (0221),
        // which also powers the walk-up dedupe. Best-effort: non-office payments match zero rows,
        // and a failure here must never make Square retry the whole event.
        if (p.order_id) {
          try {
            // Only forward transitions: never let a delayed Square retry flip a refunded order back to paid.
            await supabaseAdmin.from("business_orders")
              .update({ payment_status: "paid", payment_id: p.id })
              .eq("square_order_id", p.order_id).in("payment_status", ["pending", "invoiced", "failed"]);
          } catch { /* best-effort */ }
        }
      }
    }
    // Only ack once the write succeeded. On failure return 500 so Square RETRIES
    // (it retries on non-2xx) rather than silently dropping the state transition.
    if (err) return NextResponse.json({ ok: false }, { status: 500 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
