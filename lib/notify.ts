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

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailEnabled() || !to.includes("@")) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL, to: [to], subject: subject.slice(0, 200), text }),
    });
    return r.ok;
  } catch { return false; }
}

export async function sendSMS(to: string, body: string): Promise<boolean> {
  if (!smsEnabled()) return false;
  const num = e164(to);
  if (!num) return false;
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
    return r.ok;
  } catch { return false; }
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
}): Promise<{ sms: SendResult; email: SendResult }> {
  const [sms, mail] = await Promise.all([
    (async (): Promise<SendResult> => {
      if (!opts.phone) return "no-address";
      if (!smsEnabled()) return "off";
      return (await sendSMS(opts.phone, opts.message)) ? "sent" : "failed";
    })(),
    (async (): Promise<SendResult> => {
      if (!opts.email || !opts.email.includes("@")) return "no-address";
      if (!emailEnabled()) return "off";
      return (await sendEmail(opts.email, opts.subject, opts.message)) ? "sent" : "failed";
    })(),
  ]);
  return { sms, email: mail };
}

/**
 * What an operator may be told about the providers: booleans only. No key, no fragment of a key,
 * and no sender address ever leaves the server through this — only whether the switch is on.
 */
export function notifyStatus(): { email: boolean; sms: boolean } {
  return { email: emailEnabled(), sms: smsEnabled() };
}
