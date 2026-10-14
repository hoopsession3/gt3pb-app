// CUSTOMER NOTIFICATIONS — SMS (Twilio) + email (Resend), server-only, env-gated: with no keys
// set, every send is a clean no-op (returns false) — order paths never break while the providers
// wait on keys. Vercel env to switch on: RESEND_API_KEY + NOTIFY_FROM_EMAIL (email);
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER (SMS).
// Voice: plain, short, lifecycle facts — never marketing.

import { supabaseAdmin } from "./supabaseAdmin";
import { errorMessage } from "./errorMessage";
import { raiseAlert } from "./serverAlerts";
import { kindMuted, type CustomerKind } from "./customerNotify";
import { e164, phoneShown, quietHours, smsPlain, textsOn, TEXT_YES_CONFIRMATION } from "./texts";

// The three notifyCustomer() call sites each looked up the account email the same way
// (auth.admin.getUserById → .user?.email) — one lookup instead of three copies.
export async function accountEmail(userId: string | null): Promise<string | null> {
  if (!userId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

/** Who placed an order, for the crew to reach when its checkout stopped (R5): the name and phone the order gave, and the
 *  account's email — "Sam Lee, 864-555-0100, sam@example.com". Never throws; "a member" when there is nothing. */
export async function whoAsked(b: { name?: unknown; phone?: unknown } | null | undefined, userId: string | null): Promise<string> {
  const said = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  let email: string | null = null;
  try { email = await accountEmail(userId); } catch { email = null; }
  return [said(b?.name, 80), said(b?.phone, 30), email ?? ""].filter(Boolean).join(", ") || "a member";
}

export const emailEnabled = (): boolean =>
  !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
export const smsEnabled = (): boolean =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);

// A number is read one way everywhere (lib/texts e164): the yes is kept, looked up and texted under the same +1….

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
    return { ok: false, detail: `could not reach Resend: ${errorMessage(e, 200)}` };
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
      // Plain characters (lib/texts smsPlain, R6): one ✓ or long dash made the whole text Unicode, billed at 70 a segment.
      body: new URLSearchParams({ To: num, From: process.env.TWILIO_FROM_NUMBER!, Body: smsPlain(body).slice(0, 640) }),
    });
    if (r.ok) {
      // Their id, kept — Twilio calls it `sid` (R6: this read `id`, Resend's word, so no text's id was ever kept). A body
      // that will not parse is not a failed send — the text is already gone — so this degrades to "sent, unmatchable".
      const id = await r.json().then((j) => (typeof j?.sid === "string" ? j.sid : undefined)).catch(() => undefined);
      return { ok: true, id };
    }
    const t = await r.text().catch(() => "");
    return { ok: false, detail: `Twilio ${r.status}: ${t.slice(0, 300) || "(no body)"}` };
  } catch (e) {
    return { ok: false, detail: `could not reach Twilio: ${errorMessage(e, 200)}` };
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
 *   not-asked   a text, to a number that never said yes or has said STOP (0398) — the customer's choice, not a fault.
 *   quiet       a text, at night (9pm–8am Eastern, lib/texts) — not sent; the email still goes.
 */
export type SendResult = "sent" | "off" | "failed" | "no-address" | "not-asked" | "quiet";

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
/** Is this number's yes to texts standing (0398 text_consent_standing)? Any failure to read it is a no. */
export async function textYes(num: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin.rpc("text_consent_standing", { p_phone: num });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Record a yes or a stop for a number (0398 say_text_consent) — the checkout routes, the account route and the
 *  inbound-text route. Never throws; false when it could not be kept (the table not there yet: said in its detail). */
export async function sayTextConsent(phone: string | null | undefined, yes: boolean, source: string, userId: string | null): Promise<{ ok: boolean; standing?: boolean; detail?: string }> {
  const num = e164(phone);
  if (!num) return { ok: false, detail: "unparseable phone number" };
  if (!supabaseAdmin) return { ok: false, detail: "no database" };
  try {
    const { data, error } = await supabaseAdmin.rpc("say_text_consent", { p_phone: num, p_yes: yes, p_source: source, p_user: userId });
    if (error) return { ok: false, detail: error.message.slice(0, 200) };
    return { ok: true, standing: data === true };
  } catch (e) {
    return { ok: false, detail: errorMessage(e, 200) };
  }
}

/** A yes to texts from the checkout or the account (R6): recorded as sayTextConsent records it, and — when the number's
 *  yes is new, not one already standing — confirmed with one text, sent at once, night or day (lib/texts
 *  TEXT_YES_CONFIRMATION). `confirmed` says what became of that text; absent when none was due. Never throws. */
export async function sayTextYes(phone: string | null | undefined, source: "pack_checkout" | "delivery_checkout" | "account", userId: string | null): Promise<{ ok: boolean; standing?: boolean; confirmed?: SendResult; detail?: string }> {
  const num = e164(phone);
  if (!num) return { ok: false, detail: "unparseable phone number" };
  const was = await textYes(num);
  const r = await sayTextConsent(num, true, source, userId);
  if (!r.ok || r.standing !== true || was) return r;
  if (!smsEnabled() || !textsOn()) return { ...r, confirmed: "off" };
  const s = await sendSMS(num, TEXT_YES_CONFIRMATION);
  // A confirmation Twilio refused is the first sign the number or its keys are wrong — every order text after it fails
  // the same way. The crew hear it once, with the reason; the yes itself stays recorded.
  if (!s.ok) {
    await raiseAlert({ severity: "important", category: "order", kind: "text_confirm_failed", title: "A texts sign-up wasn't confirmed",
      body: `${phoneShown(num)} said yes to texts (${YES_WHERE[source]}) and the confirmation text failed: ${s.detail ?? "no reason given"}. Check Twilio — their order texts will fail the same way.`, link: "/crew" });
  }
  return { ...r, confirmed: s.ok ? "sent" : "failed", detail: s.detail };
}
const YES_WHERE = { pack_checkout: "at pack checkout", delivery_checkout: "at delivery checkout", account: "on their account" } as const;

/** Has this member turned a kind off on their Notifications screen (lib/customerNotify, R6)? Read through the service
 *  client from their notif_prefs row. A read that fails is a no: the news goes, as it did before the screen existed. */
export async function customerMuted(userId: string | null | undefined, kind: CustomerKind): Promise<boolean> {
  if (!userId || !supabaseAdmin) return false;
  try {
    const { data, error } = await supabaseAdmin.from("notif_prefs").select("muted_categories").eq("user_id", userId).maybeSingle();
    return !error && kindMuted((data as { muted_categories?: string[] | null } | null)?.muted_categories, kind);
  } catch {
    return false;
  }
}

export async function notifyCustomer(opts: {
  phone?: string | null; email?: string | null; subject: string; message: string;
}): Promise<{ sms: SendResult; email: SendResult; smsDetail?: string; emailDetail?: string; emailId?: string }> {
  const [sms, mail] = await Promise.all([
    (async (): Promise<[SendResult, string | undefined, undefined]> => {
      if (!opts.phone) return ["no-address", undefined, undefined];
      // Off until texts are switched on (the number registered, NEXT_PUBLIC_TEXTS_ON — Ryan's): keys alone text nobody.
      if (!smsEnabled() || !textsOn()) return ["off", undefined, undefined];
      const num = e164(opts.phone);
      if (!num) return ["no-address", "unparseable phone number", undefined];
      // A TEXT NEEDS A YES (2026-10-14, R5, 0398): only a number whose yes is standing — said at checkout or on the account,
      // not since withdrawn by STOP — and never at night. It texted any phone an order carried. A yes that cannot be read
      // (the table not there yet, the database down) is no yes: a text not sent is better than one nobody asked for.
      if (!(await textYes(num))) return ["not-asked", undefined, undefined];
      if (quietHours()) return ["quiet", undefined, undefined];
      const r = await sendSMS(num, opts.message);
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
