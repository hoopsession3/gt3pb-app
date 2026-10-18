import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, tenantFromRequest, userFromRequest } from "@/lib/apiAuth";
import { notifyCustomer, emailEnabled, smsEnabled, notifyStatus, sendEmail, accountEmail, customerMuted } from "@/lib/notify";
import { route } from "@/lib/apiRoute";
import { orderNo } from "@/lib/activeOrder";
import { orderLine } from "@/lib/orderWords";
import { money } from "@/lib/money";
import { etToday } from "@/lib/dates";

// LIFECYCLE PINGS the crew fires from the boards — the customer can't be expected to sit in the
// app. order_ready: the pass advanced an order to Ready (walk-up/pre-orders carry no phone, so
// this reaches the member's account email). delivered: a Sunday porch run outcome (delivery
// orders carry a phone — SMS + email). Staff-gated; env-gated senders no-op until keys land.
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false }, { status: 503 });
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // R-002: staff-gated, so any crew member may act on any order — within THEIR tenant. Without
  // this filter the service role would reach every tenant's orders once a second one exists.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "no tenant on this session" }, { status: 401 });
  if (!emailEnabled() && !smsEnabled()) return NextResponse.json({ ok: true, skipped: "no provider keys yet" });

  let kind = "", id = "";
  try { ({ kind = "", id = "" } = await req.json()); } catch { /* */ }

  // ── ASK THE PROVIDER DIRECTLY ──────────────────────────────────────────────────────────────────
  // When Ryan's first cap order sent no receipt on 2026-09-29, both Resend env vars were set and
  // scoped to production — so the send was attempted and REFUSED, and nothing in the app could say
  // by whom or why. This sends one real email to the caller's OWN account address and hands back
  // the provider's verdict verbatim. The operator presses it; it is never fired on their behalf,
  // and it can only ever mail the person pressing it.
  if (kind === "test") {
    // staffFromRequest is a boolean gate (already passed above); userFromRequest is who they are.
    const me = await userFromRequest(req);
    const to = await accountEmail(me?.id ?? null);
    if (!to) return NextResponse.json({ ok: false, error: "no email on your account to test with" }, { status: 400 });
    const r = await sendEmail(to, "GT3 — email test", "This is a test from GT3's integrations panel. If you are reading it, receipts and tracking emails can send.");
    return NextResponse.json({ ok: true, test: true, to, sent: r.ok, detail: r.detail ?? null });
  }

  if (!id || !["order_ready", "delivered", "order_void"].includes(kind)) {
    return NextResponse.json({ ok: false, error: "kind + id required" }, { status: 400 });
  }

  try {
    if (kind === "order_ready") {
      const { data: o } = await supabaseAdmin.from("orders").select("id, customer, user_id").eq("tenant_id", tenant).eq("id", id).maybeSingle();
      if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      const first = (o.customer || "").split(" ")[0];
      // Its number and Today's words (R3b: lib/activeOrder, lib/orderWords) — "#4F2A" is what the window calls out.
      const no = orderNo(o.id);
      // Order updates turned off on their Notifications screen (R6, lib/customerNotify): nothing sent, and said so.
      if (await customerMuted(o.user_id, "order_updates")) return NextResponse.json({ ok: true, sms: "muted", email: "muted" });
      const sent = await notifyCustomer({
        email: await accountEmail(o.user_id),
        subject: `GT3 — order ${no} is ready`,
        message: `GT3: ${first ? `${first}, ` : ""}order ${no} is ${orderLine("ready").replace(/^Ready/, "ready")}`,
        // Once (R22, lib/notify onceKey): the Pass pressed twice, or the call retried, is one email.
        key: `order-ready:${o.id}`,
      });
      return NextResponse.json({ ok: true, ...sent });
    }
    // A CUP ORDER THE CREW CANCELED (2026-10-15, R7 of the customer re-audit). The Pass's void told nobody: the order
    // slipped off the member's bar, and an email — which /api/orders/cancel sends when they cancel it themselves, and the
    // stop route when a stop is called off — never came. What becomes of the money, the tip in it (0409). A guest has no
    // address with us; their order page and bar say it. A change to the order itself: said whatever the order-updates switch.
    if (kind === "order_void") {
      const { data: o } = await supabaseAdmin.from("orders").select("id, customer, user_id, status, paid, total_cents, tip_cents, collected_at, collected_via")
        .eq("tenant_id", tenant).eq("id", id).maybeSingle();
      if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      if (o.status !== "void") return NextResponse.json({ ok: false, error: "not canceled" }, { status: 409 });
      if (!o.user_id) return NextResponse.json({ ok: true, skipped: "a guest — their order page says it" });
      const first = (o.customer || "").split(" ")[0];
      const no = orderNo(o.id);
      const charged = (o.total_cents ?? 0) + (o.tip_cents ?? 0);
      // How it was settled says what comes back (R9): cash across the window, a card — online or on the reader — refunded
      // in full, and a free cup or credit (covered, 0416) took no money at all.
      const refunding = (cents: number) => ` The crew is refunding your card in full — ${money(cents)}. If you don't see it within a few business days, reply and we'll sort it.`;
      const money$ = o.collected_via === "cash" ? " You paid cash at the window — the crew gives it back there."
        : o.collected_via === "card_reader" ? refunding(o.total_cents ?? 0)
        : o.collected_via === "covered" ? " It was covered by a free cup or credit — nothing was charged."
        : o.collected_at ? " You paid at the window — the crew gives it back there."
        : o.paid ? refunding(charged)
        : " Nothing was charged.";
      const sent = await notifyCustomer({
        email: await accountEmail(o.user_id),
        subject: `GT3 — order ${no} was canceled`,
        message: `GT3: ${first ? `${first}, ` : ""}order ${no} was canceled by the crew.${money$}`,
        // The same key the member's own cancel and a stop called off use for this order: one "canceled" each, however told.
        key: `order-canceled:${o.id}`,
      });
      return NextResponse.json({ ok: true, ...sent });
    }
    // delivered
    const { data: d } = await supabaseAdmin.from("delivery_orders")
      .select("id, name, phone, user_id, refill_count").eq("tenant_id", tenant).eq("id", id).maybeSingle();
    if (!d) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const first = (d.name || "").split(" ")[0];
    if (await customerMuted(d.user_id, "order_updates")) return NextResponse.json({ ok: true, sms: "muted", email: "muted" });
    const sent = await notifyCustomer({
      phone: d.phone,
      email: await accountEmail(d.user_id),
      subject: "GT3 — delivered",
      message: `GT3: ${first ? `${first}, ` : ""}your bottles are on the porch${Number(d.refill_count) > 0 ? " — we took your empties" : ""}. Fresh 7 days from today.`,
      // One delivery, one "delivered" — a porch run's order is delivered on its day (the business's day, lib/dates).
      key: `delivered:${d.id}:${etToday()}`,
    });
    return NextResponse.json({ ok: true, ...sent });
  } catch {
    return NextResponse.json({ ok: false, error: "notify failed" }, { status: 502 });
  }
}

// THE QUESTION NOBODY COULD ASK. components/IntegrationsPanel renders every service with a live
// probe except Email and Teams, which carry a permanent grey dot and a sentence saying they work
// "when the key is set in Vercel" — its own header admits they are "described, not guessed at",
// because there was no probe to call. So when Ryan's first cap order sent no receipt on
// 2026-09-29, there was no screen in the app that could say whether email was off or broken.
//
// Booleans only. notifyStatus() reads whether the switches are on; no key, no key fragment and no
// sender address crosses this boundary. Staff-gated all the same — which integrations a business
// has is not public.
async function get(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // Nested under `providers` on purpose: POST on this same route answers with `email` as a
  // SendResult string. Two verbs answering the same key with different types is a trap, and I
  // had just built one.
  return NextResponse.json({ ok: true, providers: notifyStatus() });
}

export const POST = route("notify", post);
export const GET = route("notify", get);
