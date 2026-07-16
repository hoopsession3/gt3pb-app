import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlert } from "@/lib/serverAlerts";

export const runtime = "nodejs";

// SOFTWARE BILLING WEBHOOK — Stripe writes the truth back onto public.tenants. Signature-verified
// (HMAC-SHA256 over `t.payload`, constant-time compare, 5-minute tolerance) — the same posture as
// the Square webhook. Dormant until STRIPE_WEBHOOK_SECRET exists. Always answers fast; Stripe
// retries on non-2xx, so only signature failures reject.
const TOLERANCE_S = 300;

function verify(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${payload}`).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex")); } catch { return false; }
}

type StripeEvent = {
  id?: string;
  type: string;
  data: { object: {
    id?: string; customer?: string; subscription?: string; client_reference_id?: string;
    status?: string; cancel_at_period_end?: boolean;
    current_period_end?: number;
    items?: { data?: { current_period_end?: number }[] };
  } };
};

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !supabaseAdmin) return NextResponse.json({ ok: true }); // dormant — ack so Stripe doesn't retry forever
  const payload = await req.text();
  if (!verify(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const evt = JSON.parse(payload) as StripeEvent;
    const o = evt.data.object;

    // INBOX — mirrors the Square webhook's replay-safety pattern (same provider-agnostic
    // webhook_events table, 0230): insert-first, so a Stripe retry/redelivery of an event we already
    // finished acks 200 and touches nothing (no duplicate tenant alerts). A prior attempt that died
    // mid-processing (row exists, processed_at still null) falls through and re-runs — every write
    // below is idempotent either way, so re-running is always safe.
    if (evt.id) {
      const { error: inboxErr } = await supabaseAdmin.from("webhook_events")
        .insert({ id: evt.id, provider: "stripe", type: evt.type, payload: evt as unknown as Record<string, unknown> });
      if (inboxErr && (inboxErr as { code?: string }).code === "23505") {
        const { data: seen } = await supabaseAdmin.from("webhook_events").select("processed_at").eq("id", evt.id).maybeSingle();
        if (seen?.processed_at) return NextResponse.json({ ok: true, replay: true });
      }
    }

    if (evt.type === "checkout.session.completed" && o.client_reference_id) {
      // A tenant just became a paying customer. 🎉 Capture the write error and check we actually
      // matched the tenant — if the provisioning write fails (or matches 0 rows), return non-2xx so
      // Stripe RETRIES. Otherwise a paid customer is silently never activated. (Square webhook does this.)
      const { data: rows, error } = await supabaseAdmin.from("tenants").update({
        plan: "pro",
        billing_status: "active",
        stripe_customer_id: typeof o.customer === "string" ? o.customer : null,
        stripe_subscription_id: typeof o.subscription === "string" ? o.subscription : null,
      }).eq("id", o.client_reference_id).select("id");
      if (error || !rows || rows.length === 0) {
        return NextResponse.json({ ok: false, error: "provision failed or matched no tenant — will retry" }, { status: 500 });
      }
      await raiseAlert({ severity: "important", category: "money", title: "New software subscription", body: `Tenant ${o.client_reference_id} subscribed.`, link: "/crew" });
    }

    if ((evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") && o.id) {
      const status = evt.type === "customer.subscription.deleted" ? "canceled" : (o.status ?? "active");
      const endS = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
      // .select("id") + a rows-matched check, same fix as checkout.session.completed above — a plain
      // { error } check doesn't catch a 0-row match (not a Postgrest error), so a webhook arriving
      // before stripe_subscription_id is ever written used to silently ACK 200 and leave the tenant's
      // billing_status stale forever (e.g. a canceled tenant keeping Pro access indefinitely).
      const { data: rows, error } = await supabaseAdmin.from("tenants").update({
        billing_status: status,
        ...(typeof endS === "number" ? { current_period_end: new Date(endS * 1000).toISOString() } : {}),
      }).eq("stripe_subscription_id", o.id).select("id");
      if (error || !rows || rows.length === 0) {
        return NextResponse.json({ ok: false, error: "update failed or matched no tenant — will retry" }, { status: 500 });
      }
      if (status === "past_due" || status === "canceled") {
        await raiseAlert({ severity: "important", category: "money", title: `Software subscription ${status}`, body: `Stripe subscription ${o.id} is ${status}.`, link: "/crew" });
      }
    }

    if (evt.id) { try { await supabaseAdmin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", evt.id); } catch { /* best-effort */ } }
  } catch { /* malformed body from a verified sender — ack and move on (don't retry a bad payload) */ }
  return NextResponse.json({ ok: true });
}
