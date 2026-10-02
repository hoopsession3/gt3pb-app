import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, tenantFromRequest, userFromRequest } from "@/lib/apiAuth";
import { notifyCustomer, emailEnabled, smsEnabled, notifyStatus, sendEmail, accountEmail } from "@/lib/notify";
import { route } from "@/lib/apiRoute";

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

  if (!id || !["order_ready", "delivered"].includes(kind)) {
    return NextResponse.json({ ok: false, error: "kind + id required" }, { status: 400 });
  }

  try {
    if (kind === "order_ready") {
      const { data: o } = await supabaseAdmin.from("orders").select("id, customer, user_id").eq("tenant_id", tenant).eq("id", id).maybeSingle();
      if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      const first = (o.customer || "").split(" ")[0];
      const sent = await notifyCustomer({
        email: await accountEmail(o.user_id),
        subject: "GT3 — your order is ready",
        message: `GT3: ${first ? `${first}, ` : ""}your order is ready at the window — come grab it while it's fresh.`,
      });
      return NextResponse.json({ ok: true, ...sent });
    }
    // delivered
    const { data: d } = await supabaseAdmin.from("delivery_orders")
      .select("id, name, phone, user_id, refill_count").eq("tenant_id", tenant).eq("id", id).maybeSingle();
    if (!d) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const first = (d.name || "").split(" ")[0];
    const sent = await notifyCustomer({
      phone: d.phone,
      email: await accountEmail(d.user_id),
      subject: "GT3 — delivered",
      message: `GT3: ${first ? `${first}, ` : ""}your bottles are on the porch${Number(d.refill_count) > 0 ? " — we took your empties" : ""}. Fresh 7 days from today.`,
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
