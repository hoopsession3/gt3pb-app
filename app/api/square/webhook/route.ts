import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, mapSubStatus } from "@/lib/squareServer";

export const runtime = "nodejs"; // needs node crypto + raw body

/* eslint-disable @typescript-eslint/no-explicit-any */
// Square subscription/invoice webhook. Verifies the HMAC over the raw body BEFORE
// any DB write, then updates the read-only mirror via the service role. The mirror
// row is created by /api/subscriptions/create (which knows the user_id); this only
// updates existing rows by square_subscription_id, so forged events can't grant access.
export async function POST(req: Request) {
  if (!supabaseAdmin || !SQUARE_WEBHOOK_SIGNATURE_KEY) return NextResponse.json({ ok: false }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-square-hmacsha256-signature") || "";
  const url = SQUARE_WEBHOOK_URL || new URL(req.url).toString();
  const expected = crypto.createHmac("sha256", SQUARE_WEBHOOK_SIGNATURE_KEY).update(url + raw).digest("base64");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const type: string = evt?.type || "";

  try {
    if (type.startsWith("subscription.")) {
      const sub = evt?.data?.object?.subscription;
      if (sub?.id) {
        await supabaseAdmin.from("subscriptions").update({
          status: mapSubStatus(sub.status),
          current_period_end: sub.charged_through_date || null,
          updated_at: new Date().toISOString(),
        }).eq("square_subscription_id", sub.id);
      }
    } else if (type === "invoice.payment_made") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) await supabaseAdmin.from("subscriptions").update({ status: "active", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId);
    } else if (type === "invoice.payment_failed") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) await supabaseAdmin.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId);
    }
  } catch { /* ack anyway so Square doesn't retry-storm; a reconcile job is the backstop */ }

  return NextResponse.json({ ok: true });
}
