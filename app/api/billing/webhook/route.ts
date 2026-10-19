import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Json } from "@/lib/database.types";
import { raiseAlertOnce } from "@/lib/serverAlerts";
import { stripeSignatureOk } from "@/lib/webhookSignature";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// SOFTWARE BILLING WEBHOOK — Stripe writes the truth back onto public.tenants. Signature-verified
// (HMAC-SHA256 over `t.payload`, constant-time compare, 5-minute tolerance) — the same posture as
// the Square webhook. Dormant until STRIPE_WEBHOOK_SECRET exists. Always answers fast; Stripe
// retries on non-2xx, so only signature failures reject.
//
// ONE CHECK FOR EVERY WEBHOOK (2026-10-11, lib/webhookSignature). This read only the LAST v1 in the
// header, and Stripe signs with both secrets while one is being rolled — a real event whose match
// came first was refused. Every v1 is tried now. A missing or wrong signature is a 401 (it was a
// 400; Stripe retries either, and 401 is what every other webhook here answers a forgery with).
//
// DORMANT IS A DECISION FOR THE OWNER, NOT THIS FILE. With STRIPE_WEBHOOK_SECRET unset this answers
// 200 and does nothing — no event is read, so no forged event can act — and Stripe stops retrying.
// Refusing instead (401/503) would start failing deliveries Stripe makes today if the endpoint is
// registered there; whether it is, is a fact of the Stripe dashboard. Left as it was, and said.

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

// THE SUBSCRIPTION AS IT STANDS, NOT AS ONE EVENT SAID (R39 — the fresh audit's API11-09). Stripe delivers events out of
// order and retries the ones that failed: an "updated" (active, cancel at period end) retried after the "deleted" put a
// canceled business back on Pro. Each subscription event now asks Stripe for the subscription as it is, and writes that —
// so the order the events arrive in decides nothing. Stripe not answering is a 500: Stripe retries, and nothing is written
// from a guess. Without the API key to ask with, the event is written as before, but a cancel is final: only a new
// checkout (a new subscription) brings a canceled business back.
type StripeSub = { status: string; periodEnd: number | null };
async function subscriptionNow(id: string): Promise<StripeSub | "unasked" | "unanswered"> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "unasked";
  try {
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
    });
    // Gone at Stripe: it was deleted, which is canceled.
    if (r.status === 404) return { status: "canceled", periodEnd: null };
    if (!r.ok) return "unanswered";
    const j = (await r.json().catch(() => null)) as { status?: unknown; current_period_end?: unknown; items?: { data?: { current_period_end?: unknown }[] } } | null;
    if (!j || typeof j.status !== "string") return "unanswered";
    const end = j.current_period_end ?? j.items?.data?.[0]?.current_period_end;
    return { status: j.status, periodEnd: typeof end === "number" ? end : null };
  } catch {
    return "unanswered";
  }
}

async function post(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !supabaseAdmin) return NextResponse.json({ ok: true }); // dormant — ack so Stripe doesn't retry forever
  const payload = await req.text();
  if (!stripeSignatureOk(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
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
        .insert({ id: evt.id, provider: "stripe", type: evt.type, payload: evt as unknown as Json });
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
      // Keyed by the tenant (R20 — API F16): a redelivery while the first is in flight is one line.
      await raiseAlertOnce({ severity: "important", category: "money", kind: "software_subscribed", subjectId: String(o.client_reference_id), title: "New software subscription", body: `Tenant ${o.client_reference_id} subscribed.`, link: "/crew" });
    }

    if ((evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") && o.id) {
      const now = await subscriptionNow(o.id);
      if (now === "unanswered") return NextResponse.json({ ok: false, error: "Stripe didn't say how the subscription stands — will retry" }, { status: 500 });
      const asked = now !== "unasked";
      const status = asked ? now.status : evt.type === "customer.subscription.deleted" ? "canceled" : (o.status ?? "active");
      const endS = asked ? now.periodEnd : o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
      // .select("id") + a rows-matched check, same fix as checkout.session.completed above — a plain
      // { error } check doesn't catch a 0-row match (not a Postgrest error), so a webhook arriving
      // before stripe_subscription_id is ever written used to silently ACK 200 and leave the tenant's
      // billing_status stale forever (e.g. a canceled tenant keeping Pro access indefinitely).
      let write = supabaseAdmin.from("tenants").update({
        billing_status: status,
        ...(typeof endS === "number" ? { current_period_end: new Date(endS * 1000).toISOString() } : {}),
      }).eq("stripe_subscription_id", o.id);
      // Unasked, a cancel is final (above): an older event never lifts it.
      if (!asked && status !== "canceled") write = write.neq("billing_status", "canceled");
      const { data: rows, error } = await write.select("id");
      if (error) return NextResponse.json({ ok: false, error: "update failed — will retry" }, { status: 500 });
      const applied = !!rows && rows.length > 0;
      if (!applied) {
        // Matched nothing: no business has this subscription yet (its checkout's event is still to come — retry), or the
        // one that has it is canceled and this older event is not let lift it (done: nothing to retry, nothing to say).
        const held = !asked && status !== "canceled"
          ? await supabaseAdmin.from("tenants").select("id").eq("stripe_subscription_id", o.id).eq("billing_status", "canceled").limit(1)
          : null;
        if (held?.error || !(held?.data ?? []).length) {
          return NextResponse.json({ ok: false, error: "matched no business — will retry" }, { status: 500 });
        }
      }
      if (applied && (status === "past_due" || status === "canceled")) {
        await raiseAlertOnce({ severity: "important", category: "money", kind: `software_subscription_${status}`, subjectId: String(o.id), title: `Software subscription ${status}`, body: `Stripe subscription ${o.id} is ${status}.`, link: "/crew" });
      }
    }

    if (evt.id) { try { const done = await supabaseAdmin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", evt.id); if (done.error) console.warn(`billing webhook: ${evt.id} processed but not marked — ${done.error.message}`); } catch { /* best-effort */ } }
  } catch { /* malformed body from a verified sender — ack and move on (don't retry a bad payload) */ }
  return NextResponse.json({ ok: true });
}

export const POST = route("billing/webhook", post);
