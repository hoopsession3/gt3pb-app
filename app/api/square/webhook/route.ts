import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, mapSubStatus } from "@/lib/squareServer";

export const runtime = "nodejs"; // needs node crypto + raw body

// Raise a money alert: drop it in the in-app inbox, then fan out via the push dispatcher
// (Teams + web push). Best-effort — a payment write must never fail because alerting did.
async function raisePaymentAlert(title: string, body: string) {
  if (!supabaseAdmin) return;
  const { data } = await supabaseAdmin.from("alerts").insert({ severity: "critical", category: "money", title, body, link: "/admin" }).select("*").single();
  if (!data) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/functions/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ table: "alerts", type: "INSERT", record: data }),
    });
  } catch { /* best effort */ }
}

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
        // A stale 'subscription.updated' must not clear past_due back to active — only a
        // real invoice.payment_made does. Other transitions (canceled/paused) still apply.
        if (next === "active") q = q.neq("status", "past_due");
        ({ error: err } = await q);
      }
    } else if (type === "invoice.payment_made") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "active", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId));
    } else if (type === "invoice.payment_failed") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId));
      // Producer: a failed payment is a money problem leadership should see fast.
      await raisePaymentAlert("Subscription payment failed", "A subscriber's card was declined — they'll lose access. Check Subscribers.");
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
