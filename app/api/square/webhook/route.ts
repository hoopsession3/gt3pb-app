import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, mapSubStatus } from "@/lib/squareServer";
import { raiseAlert, raiseAlertOnce } from "@/lib/serverAlerts";
import { moneyPlain } from "@/lib/money";
import { squareSignatureOk } from "@/lib/webhookSignature";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs"; // needs node crypto + raw body

/* eslint-disable @typescript-eslint/no-explicit-any */
// Square subscription/invoice webhook. Verifies the HMAC over the raw body BEFORE
// any DB write, then updates the read-only mirror via the service role. The mirror
// row is created by /api/subscriptions/create (which knows the user_id); this only
// updates existing rows by square_subscription_id, so forged events can't grant access.
async function post(req: Request) {
  // SQUARE_WEBHOOK_URL must be set and EXACTLY match the endpoint registered in Square,
  // because the HMAC is computed over (notificationUrl + rawBody). No req.url fallback —
  // behind a proxy that won't match and would silently reject every event.
  if (!supabaseAdmin || !SQUARE_WEBHOOK_SIGNATURE_KEY || !SQUARE_WEBHOOK_URL) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const raw = await req.text();
  // lib/webhookSignature (2026-10-11): this compare counted characters and then bytes, so a forged header with one
  // non-ASCII character threw — a 500, filed as a crash and an alert — instead of the 401 a forgery gets.
  if (!squareSignatureOk(raw, req.headers.get("x-square-hmacsha256-signature"), SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const type: string = evt?.type || "";
  const eventId: string | null = typeof evt?.event_id === "string" ? evt.event_id : null;

  // INBOX (0230): insert-first, so a Square replay/retry of an already-processed event acks 200 and
  // touches nothing (no duplicate alerts, no re-mirrors). If a PRIOR attempt died mid-processing
  // (row exists, processed_at still null) we fall through and run again — every write below is
  // idempotent. An inbox hiccup must never DROP a real event, so non-duplicate errors keep going.
  if (eventId) {
    const { error: inboxErr } = await supabaseAdmin.from("webhook_events")
      .insert({ id: eventId, provider: "square", type, payload: evt });
    if (inboxErr && (inboxErr as { code?: string }).code === "23505") {
      const { data: seen } = await supabaseAdmin.from("webhook_events")
        .select("processed_at").eq("id", eventId).maybeSingle();
      if (seen?.processed_at) return NextResponse.json({ ok: true, replay: true });
    }
  }

  try {
    let err: { message?: string } | null = null;
    if (type.startsWith("subscription.")) {
      const sub = evt?.data?.object?.subscription;
      if (sub?.id) {
        const next = mapSubStatus(sub.status);
        // scoped-by: square_subscription_id carries a UNIQUE index (verified in production) and the
        // value is minted by Square, never by a caller — at most one row in the table. There is no
        // session on a webhook to read a tenant from, so this key IS the scope.
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
        // Leadership visibility on churn — a cancel shouldn't be invisible. Gated on success so a
        // failed mirror + Square retry can't double the alert (the retry re-runs this body).
        if (next === "canceled" && !err) await raiseAlert({ severity: "important", category: "money", title: "Subscription canceled", body: "A member canceled their coffee subscription. See Subscribers." });
      }
    } else if (type === "invoice.payment_made") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      // A payment clears past_due back to active, but must never resurrect a canceled subscription.
      // scoped-by: same unique Square-issued key as above.
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "active", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId).neq("status", "canceled"));
    } else if (type === "invoice.payment_failed") {
      const subId = evt?.data?.object?.invoice?.subscription_id;
      if (subId) ({ error: err } = await supabaseAdmin.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("square_subscription_id", subId));
      // Producer: a failed payment is a money problem leadership should see fast — but only once:
      // gated on success so the 500-retry path can't stack duplicate criticals.
      if (!err) await raiseAlert({ severity: "critical", category: "money", title: "Subscription payment failed", body: "A subscriber's card was declined — they'll lose access. Check Subscribers." });
    } else if (type.startsWith("refund.")) {
      // MONEY LEAVING (0330). Before this branch a refund issued in the Square dashboard — which is
      // where this app's own money panel sends the owner to issue one — never reached the database.
      //
      // Written to square_refunds, NOT to shop_orders.refund_amount_cents. That column has one
      // writer (0313's set_shop_order_status) and this is SQUARE's account, not the operator's; the
      // two are compared in v_shop_money_drift precisely because they can disagree. An upsert on
      // Square's own refund id is also idempotent, which `x = x + amount` would not be on the retry
      // this route deliberately performs.
      const rf = evt?.data?.object?.refund;
      if (rf?.id && rf?.payment_id) {
        const cents = Number(rf?.amount_money?.amount ?? 0) || 0;
        // scoped-by: payment_id is minted by Square and matched against the order recorded at
        // checkout. A caller cannot supply it — this request is HMAC-verified above.
        const { data: ord } = await supabaseAdmin.from("shop_orders")
          .select("id, refund_amount_cents, ship_name, email")
          .eq("payment_id", String(rf.payment_id)).maybeSingle();
        const o = ord as { id?: string; refund_amount_cents?: number | null; ship_name?: string | null; email?: string | null } | null;
        ({ error: err } = await supabaseAdmin.from("square_refunds").upsert({
          id: String(rf.id),
          payment_id: String(rf.payment_id),
          order_id: o?.id ?? null,
          amount_cents: cents,
          status: String(rf?.status ?? "UNKNOWN"),
          reason: rf?.reason ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" }));
        // Only a COMPLETED refund is money that left, and only say something when this app's own
        // record does not already cover it — a refund entered here and then confirmed by Square is
        // the workflow working, not a problem.
        //
        // ALL OF WHAT WENT BACK, NOT THIS ONE (R9, 0417): it compared this refund alone with the order's total recorded,
        // so a second $5 back in Square, after the first was recorded, said nothing — $10 out, $5 on the books. Every
        // completed refund on the payment is summed, and the alert says what is missing; a part is recorded on the order
        // now (0417), and the order stays open.
        if (!err && String(rf?.status) === "COMPLETED" && o?.id) {
          // scoped-by: payment_id is minted by Square — the same payment this order was matched on above.
          const all = await supabaseAdmin.from("square_refunds").select("amount_cents").eq("payment_id", String(rf.payment_id)).eq("status", "COMPLETED");
          const back = all.error ? cents : (all.data ?? []).reduce((n, r) => n + (Number((r as { amount_cents?: number }).amount_cents) || 0), 0);
          const recorded = o.refund_amount_cents ?? 0;
          if (recorded < back) {
            await raiseAlertOnce({
              severity: "critical", category: "money", kind: "refund_unrecorded", subjectId: o.id,
              title: "A refund was issued in Square and this app does not know",
              body: `${o.ship_name || o.email || "A customer"} has been refunded $${moneyPlain(back)} in Square, and this order records $${moneyPlain(recorded)}. Record the other $${moneyPlain(back - recorded)} on the order — Record a refund, with that amount and a reason. A part keeps the order open; all of it ends it.`,
              // The order is the Catalog's since 2026-10-15 (the shop's queue moved there from Money): the refund is marked on it.
              link: "/crew?s=catalog&a=shoporders",
            });
          }
        }
      }
    } else if (type.startsWith("dispute.")) {
      // A CHARGEBACK (0330). Nothing in this app knew disputes existed. The field that matters is
      // due_at: miss it and the dispute is lost by default, for the full amount plus the bank's fee.
      // It goes to v_obligations with every other deadline — an alert scrolls away, a deadline does
      // not — and raises one critical on top, once, while it is unacknowledged.
      const dp = evt?.data?.object?.dispute;
      const dId = dp?.dispute_id ?? dp?.id;
      const payId = dp?.disputed_payment?.payment_id ?? dp?.payment_id;
      if (dId && payId) {
        const cents = Number(dp?.amount_money?.amount ?? 0) || 0;
        // scoped-by: payment_id is Square's, matched against the order recorded at checkout.
        const { data: ord } = await supabaseAdmin.from("shop_orders")
          .select("id, ship_name, email").eq("payment_id", String(payId)).maybeSingle();
        const o = ord as { id?: string; ship_name?: string | null; email?: string | null } | null;
        ({ error: err } = await supabaseAdmin.from("square_disputes").upsert({
          id: String(dId),
          payment_id: String(payId),
          order_id: o?.id ?? null,
          amount_cents: cents,
          state: dp?.state ?? null,
          due_at: dp?.due_at ?? null,
          reason: dp?.reason ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" }));
        const decided = ["WON", "LOST", "ACCEPTED"].includes(String(dp?.state ?? ""));
        if (!err && !decided) {
          const by = dp?.due_at ? ` Evidence is due by ${String(dp.due_at).slice(0, 10)}.` : "";
          // Square's dispute id is not a uuid. Until 2026-10-04 that made the database refuse this
          // alert outright (alerts.subject_id is a uuid) and the helper swallowed the refusal, so it
          // never fired. raiseAlertOnce now turns the id into a stable uuid (lib/alertSubject).
          await raiseAlertOnce({
            severity: "critical", category: "money", kind: "chargeback_open", subjectId: String(dId),
            title: `A card dispute was opened for $${moneyPlain(cents)}`,
            body: `${o?.ship_name || o?.email || "A customer"} disputed a payment.${by} A dispute with no evidence filed is lost by default — the amount and the bank's fee both go. Respond in Square.`,
            // Money › Get paid lists every open chargeback with its evidence date (2026-10-15); the shop's queue never showed one.
            link: "/crew?s=money&a=pay",
          });
        }
      }
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
        // THE ORDER AS IT IS (R9, 2026-10-16). Only an order still owed was ever matched, so two payments went unseen:
        //   · a link paid after its order was canceled — the money is in, and a refund is owed: flagged, critical. Its
        //     payment stays on no order, so the books count it as walk-up money until it is given back (0417 takes the
        //     refund off there);
        //   · a link paid after the order was marked paid by hand — the crew is asked whether they paid twice. The payment
        //     stays on no order: Money counts it as walk-up money, and when the extra one is given back its refund comes off
        //     there (0417). Put on the order, its refund came off the office's — the order paid by hand read $0.
        if (p.order_id) {
          try {
            // scoped-by: square_order_id is minted by Square and matched against the row we created
            // when the invoice was raised. A caller cannot supply it — Square signs this request.
            const { data: bo } = await supabaseAdmin.from("business_orders")
              .select("id, company, payment_status, payment_id, canceled_at").eq("square_order_id", p.order_id).maybeSingle();
            const cents = p?.amount_money?.amount ?? 0;
            if (bo?.canceled_at) {
              // Its own flag, by the payment (R9): keyed on the order, it met the flag its cancel had raised ("marked paid —
              // settle it") and was never written — the card payment was flagged nowhere.
              await raiseAlertOnce({
                severity: "critical", category: "money", kind: "refund_needed", subjectId: `office-pay:${p.id}`,
                title: "A canceled office order was paid — refund needed",
                body: `${bo.company || "An office"} paid $${moneyPlain(cents)} through the payment link of an order that was canceled. Refund it in Square — or put the order back with them.`,
                link: "/crew?s=money&a=pay",
              });
            } else if (bo && ["pending", "invoiced", "failed"].includes(String(bo.payment_status))) {
              // Only forward transitions: never let a delayed Square retry flip a refunded order back to paid.
              // scoped-by: the row Square's own order id just matched, and only while it is still owed.
              await supabaseAdmin.from("business_orders")
                .update({ payment_status: "paid", payment_id: p.id })
                .eq("id", bo.id).in("payment_status", ["pending", "invoiced", "failed"]);
            } else if (bo && bo.payment_status === "paid" && bo.payment_id !== p.id) {
              await raiseAlertOnce({
                severity: "important", category: "money", kind: "office_paid_twice", subjectId: String(bo.id),
                title: "An office order already paid was paid by its link too",
                body: `${bo.company || "An office"} was already marked paid, and its payment link was just paid ($${moneyPlain(cents)}, Square payment ending ${String(p.id).slice(-6)}). If they paid twice, refund that one in Square.`,
                link: "/crew?s=money&a=pay",
              });
            }
          } catch { /* best-effort */ }
        }
      }
    }
    // Only ack once the write succeeded. On failure return 500 so Square RETRIES
    // (it retries on non-2xx) rather than silently dropping the state transition. The inbox row
    // keeps processed_at null on a failure — which is exactly what lets the retry re-run the body.
    if (err) {
      if (eventId) { try { await supabaseAdmin.from("webhook_events").update({ error: err.message || "processing failed" }).eq("id", eventId); } catch { /* best-effort */ } }
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  } catch {
    if (eventId) { try { await supabaseAdmin.from("webhook_events").update({ error: "processing threw" }).eq("id", eventId); } catch { /* best-effort */ } }
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (eventId) { try { await supabaseAdmin.from("webhook_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", eventId); } catch { /* best-effort */ } }
  return NextResponse.json({ ok: true });
}

export const POST = route("square/webhook", post);
