// CUSTOMER NOTIFICATIONS — SMS (Twilio) + email (Resend), server-only, env-gated: with no keys
// set, every send is a clean no-op (returns false) — order paths never break while the providers
// wait on keys. Vercel env to switch on: RESEND_API_KEY + NOTIFY_FROM_EMAIL (email);
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER (SMS).
// Voice: plain, short, lifecycle facts — never marketing.

import { supabaseAdmin } from "./supabaseAdmin";

// The three notifyCustomer() call sites each looked up the account email the same way
// (auth.admin.getUserById → .user?.email) — one lookup instead of three copies.
export async function accountEmail(userId: string | null): Promise<string | null> {
  if (!userId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

export const emailEnabled = (): boolean =>
  !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
export const smsEnabled = (): boolean =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);

// US-centric E.164 normalize — 10 digits get +1; anything unparseable is skipped, not errored.
const e164 = (raw: string): string | null => {
  const plus = raw.trim().startsWith("+");
  const n = raw.replace(/\D/g, "");
  if (plus && n.length >= 11) return `+${n}`;
  if (n.length === 10) return `+1${n}`;
  if (n.length === 11 && n.startsWith("1")) return `+${n}`;
  return null;
};

/**
 * ── WHY THIS RETURNS A REASON ──────────────────────────────────────────────────────────────────
 * It used to `return r.ok`. Resend answers a refusal with a body saying exactly what is wrong —
 * domain not verified, key revoked, recipient not allowed while the account is unverified — and
 * that body went straight in the bin. So when Ryan's first cap order sent no receipt on
 * 2026-09-29, the one piece of information that would have explained it had been discarded one
 * line after it arrived, by this function.
 *
 * The reason is for the OPERATOR — an alert, the integrations panel. It never reaches a customer,
 * who cannot act on "domain is not verified" and should not be reading it.
 */
// `id` is the provider's own id for the message — Resend's, when Resend accepted it.
//
// It was thrown away until 0332, and that discard is the same defect as the one this file was
// edited for this morning: the provider tells you something and the code drops it. That time it was
// the failure words, and the fix was to keep them. This time it is the id, and without it a delivery
// webhook has nothing to match on — a receipt that hard-bounces stays indistinguishable from one
// that was read, because nothing connects Resend's later news to the row we wrote.
export type Sent = { ok: boolean; detail?: string; id?: string };

export async function sendEmail(to: string, subject: string, text: string): Promise<Sent> {
  // ADDRESS FIRST, then config — the same order notifyCustomer uses. It checked config first when
  // this was written, so the two disagreed about which of two simultaneous problems to report, in
  // code added ten minutes apart. "No address" is about THIS message and is true whatever the env
  // says; "no key" is the standing condition underneath it.
  if (!to.includes("@")) return { ok: false, detail: "no email address on the order" };
  if (!emailEnabled()) return { ok: false, detail: "no RESEND_API_KEY / NOTIFY_FROM_EMAIL" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL, to: [to], subject: subject.slice(0, 200), text }),
    });
    if (r.ok) {
      // Their id, kept. A body that will not parse is not a failed send — the mail is already gone —
      // so this degrades to "sent, unmatchable" rather than claiming the send failed.
      const id = await r.json().then((j) => (typeof j?.id === "string" ? j.id : undefined)).catch(() => undefined);
      return { ok: true, id };
    }
    // Their words, trimmed — not a guess at what went wrong. A wrong explanation sends an operator
    // to fix the wrong thing, which is worse than no explanation at all.
    const body = await r.text().catch(() => "");
    return { ok: false, detail: `Resend ${r.status}: ${body.slice(0, 300) || "(no body)"}` };
  } catch (e) {
    return { ok: false, detail: `could not reach Resend: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

export async function sendSMS(to: string, body: string): Promise<Sent> {
  if (!smsEnabled()) return { ok: false, detail: "no Twilio keys" };
  const num = e164(to);
  if (!num) return { ok: false, detail: `unparseable phone number` };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: num, From: process.env.TWILIO_FROM_NUMBER!, Body: body.slice(0, 640) }),
    });
    if (r.ok) {
      // Their id, kept. A body that will not parse is not a failed send — the mail is already gone —
      // so this degrades to "sent, unmatchable" rather than claiming the send failed.
      const id = await r.json().then((j) => (typeof j?.id === "string" ? j.id : undefined)).catch(() => undefined);
      return { ok: true, id };
    }
    const t = await r.text().catch(() => "");
    return { ok: false, detail: `Twilio ${r.status}: ${t.slice(0, 300) || "(no body)"}` };
  } catch (e) {
    return { ok: false, detail: `could not reach Twilio: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * WHAT HAPPENED TO ONE CHANNEL. Four outcomes, because they are four different problems and
 * flattening them into a boolean is exactly what hid this:
 *
 *   sent        it went.
 *   off         no provider keys. A STANDING condition — the operator's integrations panel should
 *               say so once, and no individual order should raise an alarm about it.
 *   failed      keys are set and the provider refused, or the network died. That IS per-order, and
 *               somebody has to hear about it.
 *   no-address  there was nobody to send to. Also per-order, and a different fix.
 */
export type SendResult = "sent" | "off" | "failed" | "no-address";

/** Did a channel actually reach anyone? */
export const didSend = (r: SendResult): boolean => r === "sent";

// Best-effort, both channels in parallel, never throws — an order must never fail because a
// notification provider hiccuped.
//
// ── WHY THIS STOPPED RETURNING BOOLEANS ────────────────────────────────────────────────────────
// Ryan bought the first cap on 2026-09-29. The charge went through, the order reached the printer,
// the confirmation screen said "You'll get an email now" — and no email arrived. Nothing anywhere
// could say why. This returned false for "Resend has no key" and false for "Resend refused it";
// six of its seven callers awaited it and discarded the answer entirely; and the one operator
// screen that reports integration health renders Email as a permanent grey dot, because it had
// nothing it could ask. A no-op nobody can observe is indistinguishable from a feature that works.
export async function notifyCustomer(opts: {
  phone?: string | null; email?: string | null; subject: string; message: string;
}): Promise<{ sms: SendResult; email: SendResult; smsDetail?: string; emailDetail?: string; emailId?: string }> {
  const [sms, mail] = await Promise.all([
    (async (): Promise<[SendResult, string | undefined, undefined]> => {
      if (!opts.phone) return ["no-address", undefined, undefined];
      if (!smsEnabled()) return ["off", undefined, undefined];
      const r = await sendSMS(opts.phone, opts.message);
      return [r.ok ? "sent" : "failed", r.detail, undefined];
    })(),
    (async (): Promise<[SendResult, string | undefined, string | undefined]> => {
      if (!opts.email || !opts.email.includes("@")) return ["no-address", undefined, undefined];
      if (!emailEnabled()) return ["off", undefined, undefined];
      const r = await sendEmail(opts.email, opts.subject, opts.message);
      return [r.ok ? "sent" : "failed", r.detail, r.id];
    })(),
  ]);
  return { sms: sms[0], email: mail[0], smsDetail: sms[1], emailDetail: mail[1], emailId: mail[2] };
}

/**
 * What an operator may be told about the providers: booleans only. No key, no fragment of a key,
 * and no sender address ever leaves the server through this — only whether the switch is on.
 */
export function notifyStatus(): { email: boolean; sms: boolean } {
  return { email: emailEnabled(), sms: smsEnabled() };
}
