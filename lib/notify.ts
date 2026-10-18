// CUSTOMER NOTIFICATIONS — SMS (Twilio) + email (Resend), server-only, env-gated: with no keys
// set, every send is a clean no-op (returns false) — order paths never break while the providers
// wait on keys. Vercel env to switch on: RESEND_API_KEY + NOTIFY_FROM_EMAIL (email);
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER (SMS).
// Voice: plain, short, lifecycle facts — never marketing.

import { supabaseAdmin } from "./supabaseAdmin";
import { errorMessage } from "./errorMessage";
import { raiseAlert } from "./serverAlerts";
import { kindMuted, type CustomerKind } from "./customerNotify";
import { e164, phoneShown, quietHours, smsPlain, textsOn, usTextable, TEXTS_PER_NUMBER_DAY, TEXT_YES_CONFIRMATION } from "./texts";
import { createHash } from "node:crypto";

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

/**
 * ── THE SAME MESSAGE, ONCE (R22 — the 10/10 audit, API F11) ─────────────────────────────────────
 * A key names what happened — "order-ready:<order>", "stop-canceled:<stop>:<order>" — and the same key twice is the same
 * message: a crew member's double press, a retry after a call that died half way, a provider's webhook told twice. Email:
 * Resend keeps the key a day (its Idempotency-Key) and answers a repeat with the first send instead of sending again.
 * A text: claimed once in public.message_sent (0429) just before it goes, marked when it went, let go again if it didn't —
 * Twilio keeps no such key. A message with no key (a test, a receipt the crew sends again on purpose) goes each time.
 */
export function onceKey(key: string | null | undefined): string | null {
  if (typeof key !== "string" || !key.trim()) return null;
  return key.trim().replace(/[^\w:.@-]/g, "_").slice(0, 200);
}

export async function sendEmail(to: string, subject: string, text: string, opts: { key?: string | null } = {}): Promise<Sent> {
  // ADDRESS FIRST, then config — the same order notifyCustomer uses. It checked config first when
  // this was written, so the two disagreed about which of two simultaneous problems to report, in
  // code added ten minutes apart. "No address" is about THIS message and is true whatever the env
  // says; "no key" is the standing condition underneath it.
  if (!to.includes("@")) return { ok: false, detail: "no email address on the order" };
  if (!emailEnabled()) return { ok: false, detail: "no RESEND_API_KEY / NOTIFY_FROM_EMAIL" };
  const key = onceKey(opts.key);
  try {
    for (let tries = 0; ; tries++) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL, to: [to], subject: subject.slice(0, 200), text }),
        // A deadline (R10b): a send that has not been answered in ten seconds is reported failed, not waited on.
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        // Their id, kept. A body that will not parse is not a failed send — the mail is already gone —
        // so this degrades to "sent, unmatchable" rather than claiming the send failed. The same key and body again is
        // answered with the first send's id: one email, which the log (lib/customerMessage) keeps one row for.
        const id = await r.json().then((j) => (typeof j?.id === "string" ? j.id : undefined)).catch(() => undefined);
        return { ok: true, id };
      }
      // THE SAME KEY, ANSWERED 409 (R22 — the R22 review). The first press is still going: asked again a moment later,
      // Resend answers with what became of it — never "sent" on the strength of someone else's send. The key with other
      // words (a refund's amount re-read): not sent, and said — whether the first went is that call's to say.
      if (r.status === 409 && key) {
        const name = await r.clone().json().then((j) => (typeof j?.name === "string" ? j.name : ""), () => "");
        if (name === "concurrent_idempotent_requests" && tries < 2) { await new Promise((ok) => setTimeout(ok, 1000 * (tries + 1))); continue; }
        if (name === "concurrent_idempotent_requests") return { ok: false, detail: "not confirmed: the same message was still being sent by an earlier call" };
        if (name === "invalid_idempotent_request") return { ok: false, detail: "not sent: this was asked for once today in other words (the same key) — see that send" };
      }
      // Their words, trimmed — not a guess at what went wrong. A wrong explanation sends an operator
      // to fix the wrong thing, which is worse than no explanation at all.
      const body = await r.text().catch(() => "");
      return { ok: false, detail: `Resend ${r.status}: ${body.slice(0, 300) || "(no body)"}` };
    }
  } catch (e) {
    return { ok: false, detail: `could not reach Resend: ${errorMessage(e, 200)}` };
  }
}

/** A number as the limiter's store keeps it: a digest — the counts, never the number. */
const numberKey = (num: string) => createHash("sha256").update(num).digest("hex").slice(0, 24);

export async function sendSMS(to: string, body: string): Promise<Sent> {
  if (!smsEnabled()) return { ok: false, detail: "no Twilio keys" };
  const num = e164(to);
  if (!num) return { ok: false, detail: `unparseable phone number` };
  // US numbers only, and a day's few to each (R9 — the abuse audit's third): a text is paid per message, to whichever
  // carrier the number is on. The count is kept by a digest of the number, in the store every instance shares; it fails
  // open, as every limiter here does.
  if (!usTextable(num)) return { ok: false, detail: "we text US numbers only" };
  if (supabaseAdmin) {
    const fits = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `sms:${numberKey(num)}`, p_window_ms: 86_400_000, p_max: TEXTS_PER_NUMBER_DAY }).then((r) => r, () => ({ data: null }));
    if ((fits as { data?: unknown }).data === false) return { ok: false, detail: "this number has had today's texts" };
  }
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
      signal: AbortSignal.timeout(10_000),
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
  // Once a day to a number (R9): a yes switched off and on again from the account re-sent it every time — a text, paid,
  // to a number of the caller's choosing, for each tap. The yes is kept; its confirmation goes once.
  if (supabaseAdmin) {
    const once = await supabaseAdmin.rpc("rate_limit_hit", { p_bucket: `text-yes:${numberKey(num)}`, p_window_ms: 86_400_000, p_max: 1 }).then((x) => x, () => ({ data: null }));
    if ((once as { data?: unknown }).data === false) return { ...r, confirmed: "off" };
  }
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

/** A text's key, claimed once (0429 message_sent): "claimed" — this call sends it; "sent" — it went before; "going" — another
 *  call claimed it a moment ago and is sending it; "unknown" — the ledger couldn't be asked (not there yet, the database
 *  down): it sends, as the push function does (a text missed is worse than one doubled).
 *  A claim never marked sent for two minutes is a call that died on the way (the R22 review: the stop-cancel retry's own
 *  case): the next call takes it over and sends — if the first had reached Twilio before it died, that one text is
 *  doubled, the price of never leaving one unsent. */
const TEXT_IN_FLIGHT_MS = 120_000;
async function claimText(key: string): Promise<"claimed" | "sent" | "going" | "unknown"> {
  if (!supabaseAdmin) return "unknown";
  const k = `text:${key}`;
  try {
    // scoped-by: a ledger of keys only — no tenant's data in it, the service role's alone (0429)
    const { error } = await supabaseAdmin.from("message_sent").insert({ event_key: k });
    if (!error) return "claimed";
    if (error.code !== "23505") return "unknown";
    // scoped-by: the one key just refused as a duplicate
    const taken = await supabaseAdmin.from("message_sent").update({ claimed_at: new Date().toISOString() })
      .eq("event_key", k).is("sent_at", null).lt("claimed_at", new Date(Date.now() - TEXT_IN_FLIGHT_MS).toISOString()).select("event_key");
    if (taken.error) return "unknown";
    if (taken.data?.length) return "claimed";
    // scoped-by: the same one key
    // arrives-with: 0429 — until it is pasted the claim's insert above already failed (no table), so this is never asked
    const { data: row, error: unread } = await supabaseAdmin.from("message_sent").select("sent_at").eq("event_key", k).maybeSingle();
    if (unread) return "unknown";
    return (row as { sent_at?: string | null } | null)?.sent_at ? "sent" : "going";
  } catch { return "unknown"; }
}
/** The claimed text went: marked, so no later call takes it over. */
async function markTextSent(key: string): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    // scoped-by: the one key this call claimed
    const { error } = await supabaseAdmin.from("message_sent").update({ sent_at: new Date().toISOString() }).eq("event_key", `text:${key}`);
    if (error) console.error(`text ${key}: sent, but not marked (${error.code || "no code"}) — a retry two minutes on would text it again`);
  } catch { /* as above */ }
}
/** A claimed text that didn't go is let go again, so a retry can send it. */
async function releaseText(key: string): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    // scoped-by: the one key this call claimed
    const { error } = await supabaseAdmin.from("message_sent").delete().eq("event_key", `text:${key}`).is("sent_at", null);
    // A key left behind is taken over by a retry two minutes on — never a wrong text — and is said.
    if (error) console.error(`text ${key}: not sent, and its key could not be let go (${error.code || "no code"}) — a retry in two minutes takes it over`);
  } catch { /* as above */ }
}

export async function notifyCustomer(opts: {
  phone?: string | null; email?: string | null; subject: string; message: string;
  /** What happened, named (onceKey): the same key twice is told once, by email and by text. */
  key?: string | null;
}): Promise<{ sms: SendResult; email: SendResult; smsDetail?: string; emailDetail?: string; emailId?: string }> {
  const key = onceKey(opts.key);
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
      const claim = key ? await claimText(key) : "unknown";
      if (claim === "sent") return ["sent", "sent once already — the same thing, told again", undefined];
      if (claim === "going") return ["sent", "being sent by another call just now — the same thing, told twice", undefined];
      const r = await sendSMS(num, opts.message);
      if (claim === "claimed") await (r.ok ? markTextSent(key!) : releaseText(key!));
      return [r.ok ? "sent" : "failed", r.detail, undefined];
    })(),
    (async (): Promise<[SendResult, string | undefined, string | undefined]> => {
      if (!opts.email || !opts.email.includes("@")) return ["no-address", undefined, undefined];
      if (!emailEnabled()) return ["off", undefined, undefined];
      const r = await sendEmail(opts.email, opts.subject, opts.message, { key });
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
