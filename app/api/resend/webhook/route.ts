import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlertOnce } from "@/lib/serverAlerts";
import { svixSignatureOk } from "@/lib/webhookSignature";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs"; // needs node crypto + the raw body

// RESEND → us: what actually happened to the email (0332).
//
// customer_messages.status has only ever meant "Resend returned 2xx to our POST". This is the other
// half: their news about the message afterwards. A hard bounce, a spam complaint, a delivery — none
// of it reached this app before, so a receipt that never landed looked exactly like one that was
// read, and the only way anybody found out was a customer saying so.
//
// ── VERIFICATION ───────────────────────────────────────────────────────────────────────────────
// Resend signs with Svix. The signed payload is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC
// SHA-256 with the secret AFTER its `whsec_` prefix, base64-decoded. The svix-signature header can
// carry SEVERAL space-separated `v1,<sig>` values during a secret rotation, so every one is checked
// — accepting only the first would reject real events for the whole rotation window.
//
// Verified BEFORE any write and before the body is trusted, the same order as the Square webhook.
// There is no separate secret for "test mode": an unverifiable event is simply not ours.
// Replay window: Svix's own guidance, five minutes; without it a captured event can be replayed
// for ever, and this one can flip a message to 'bounced'. The check itself is lib/webhookSignature's
// (2026-10-11), one place for every webhook, run against made-up secrets by scripts/webhooks.test.mjs.
function verify(raw: string, h: Headers): boolean {
  return svixSignatureOk(raw, { id: h.get("svix-id"), timestamp: h.get("svix-timestamp"), signature: h.get("svix-signature") },
    process.env.RESEND_WEBHOOK_SECRET);
}

async function post(req: Request) {
  const raw = await req.text();
  if (!supabaseAdmin || !process.env.RESEND_WEBHOOK_SECRET) return NextResponse.json({ ok: false }, { status: 503 });
  if (!verify(raw, req.headers)) return NextResponse.json({ ok: false }, { status: 401 });

  let evt: { type?: string; created_at?: string; data?: { email_id?: string; to?: string[]; bounce?: { message?: string; type?: string } } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const type = String(evt?.type ?? "");
  const emailId = String(evt?.data?.email_id ?? "");
  // Nothing to match on is not an error worth retrying — Svix would keep re-sending forever.
  if (!emailId) return NextResponse.json({ ok: true, ignored: "no email_id" });

  // Their timestamp, not ours: the event describes something that happened on their clock, and a
  // retry an hour later must not record the bounce as having happened an hour late.
  const at = (() => {
    const t = Date.parse(String(evt?.created_at ?? ""));
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  })();

  // One column per outcome rather than a status string, so a delivery followed by a complaint keeps
  // BOTH facts — v_customer_message_outcome decides which one to lead with.
  const patch: Record<string, string | null> = {};
  if (type === "email.delivered") patch.delivered_at = at;
  else if (type === "email.bounced") {
    patch.bounced_at = at;
    const b = evt?.data?.bounce;
    patch.delivery_detail = [b?.type, b?.message].filter(Boolean).join(": ").slice(0, 300) || "bounced";
  } else if (type === "email.complained") patch.complained_at = at;
  else return NextResponse.json({ ok: true, ignored: type });   // opened/clicked/sent — not our question

  // scoped-by: provider_id is minted by Resend and carries a unique index (0332). It cannot be
  // supplied by a caller — this request is signature-verified above — so the key IS the scope, the
  // same argument the Square webhook makes for square_subscription_id.
  const { data: row, error } = await supabaseAdmin.from("customer_messages")
    .update(patch).eq("provider_id", emailId)
    .select("id, order_id, to_address, kind").maybeSingle();

  // 500 so Svix retries: a message we sent moments ago may not be committed yet, and dropping a
  // bounce is the failure this route exists to prevent.
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  if (!row) return NextResponse.json({ ok: true, unmatched: true });

  if (type === "email.bounced" || type === "email.complained") {
    const r = row as { id: string; order_id: string | null; to_address: string; kind: string };
    const what = type === "email.bounced" ? "bounced" : "was marked as spam";
    await raiseAlertOnce({
      severity: "important", category: "order", kind: "email_undelivered", subjectId: r.id,
      title: `A ${r.kind.replace(/_/g, " ")} email ${what}`,
      body: `The ${r.kind.replace(/_/g, " ")} sent to ${r.to_address} ${what} — ${patch.delivery_detail ?? "no detail given"}. ` +
            `That customer has heard nothing. Check the address on the order and send it again.`,
      link: "/crew?s=catalog&a=shoporders",
    });
  }

  return NextResponse.json({ ok: true });
}

export const POST = route("resend/webhook", post);
