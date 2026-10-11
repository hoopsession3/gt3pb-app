import { createHmac, timingSafeEqual } from "node:crypto";

// AN INBOUND WEBHOOK PROVES WHO SENT IT, IN ONE PLACE (2026-10-11, wave 2 · alerts).
//
// Four senders write to this app without a session — Square, Resend (through Svix), Stripe and Apliiq — and one
// inbound-email service that cannot sign at all and sends a shared token instead. Each route checked its own
// signature its own way, four copies of "HMAC, then compare". Two of the copies could be talked into the wrong answer:
//
//   · Square compared lengths in characters and then bytes. A forged header with one non-ASCII character in it is
//     the right length in characters and the wrong one in bytes, so timingSafeEqual threw, and the route answered a
//     forgery with a 500 — filed as a crash (lib/apiRoute → the error intake → an alert in the crew's inbox) and
//     retried by the sender. Anyone could raise that alert, as often as they liked.
//   · Stripe read only the LAST v1 signature in its header. During a secret roll Stripe signs with the old and the
//     new secret both; a real event whose matching signature came first was refused.
//
// These are the checks, pure: the raw body exactly as it arrived, the headers that sign it, the secret. Each answers
// true only for a valid signature, and false for a missing one, a wrong one, a stale one or one that cannot be read
// — never throws. A route answers false with 401. scripts/webhooks.test.mjs signs with made-up secrets and runs them,
// and runs each route on top of them.

/** The same bytes, compared in constant time; false (never a throw) when the lengths differ. */
export function sameBytes(got: string, expected: string): boolean {
  const a = Buffer.from(got, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Square: base64(HMAC-SHA256(signature key, notification URL + raw body)) in x-square-hmacsha256-signature. The URL is
 *  the one registered in Square, exactly — behind a proxy, req.url is not it (app/api/square/webhook). */
export function squareSignatureOk(rawBody: string, header: string | null | undefined, signatureKey: string, notificationUrl: string): boolean {
  if (!header || !signatureKey || !notificationUrl) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl + rawBody).digest("base64");
  return sameBytes(header, expected);
}

/** Svix's replay window, its own guidance: a captured event is good for five minutes, not for ever. */
export const SVIX_TOLERANCE_S = 300;

/** Resend, through Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw body}`, keyed by the secret after its
 *  `whsec_` prefix, base64-decoded. svix-signature carries one or more space-separated `v1,<base64>` — several during
 *  a secret rotation, and any one of them may be the match. */
export function svixSignatureOk(
  rawBody: string,
  h: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined },
  secret: string | null | undefined,
  nowS: number = Date.now() / 1000,
): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!/^\d+$/.test(h.timestamp) || !Number.isFinite(ts) || Math.abs(nowS - ts) > SVIX_TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest("base64");
  return h.signature.split(" ").some((part) => part.startsWith("v1,") && sameBytes(part.slice(3), expected));
}

/** Stripe's default tolerance for a signed timestamp. */
export const STRIPE_TOLERANCE_S = 300;

/** Stripe: `t=<unix>,v1=<hex>[,v1=<hex>…][,v0=…]` in Stripe-Signature; v1 is hex(HMAC-SHA256(secret, `${t}.${raw body}`)).
 *  Every v1 is tried — Stripe signs with both secrets while one is being rolled. v0 (test mode's old scheme) is not. */
export function stripeSignatureOk(rawBody: string, header: string | null | undefined, secret: string | null | undefined, nowS: number = Date.now() / 1000): boolean {
  if (!header || !secret) return false;
  let t: string | null = null;
  const v1: string[] = [];
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1" && v) v1.push(v);
  }
  if (t === null || !/^\d+$/.test(t) || !v1.length) return false;
  if (Math.abs(nowS - Number(t)) > STRIPE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1.some((s) => sameBytes(s, expected));
}

/** Apliiq: `x-apliiq-auth RTS:SIG:APPID:STATE`, SIG = base64(HMAC-SHA256(shared secret, APPID + RTS + STATE +
 *  base64(raw body))) — their Authentication Guide, as lib/apliiq signs its own calls to them. */
export function apliiqSignatureOk(rawBody: string, authHeader: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const token = (authHeader || "").replace(/^\s*x-apliiq-auth\s+/i, "").trim();
  const parts = token.split(":");
  if (parts.length < 4) return false;
  const [rts, sig, appid, state] = parts;
  if (!rts || !sig || !appid || !state) return false;
  const b64 = rawBody ? Buffer.from(rawBody).toString("base64") : "";
  const expected = createHmac("sha256", secret).update(appid + rts + state + b64).digest("base64");
  return sameBytes(sig, expected);
}

/** A shared token on the request (an inbound-email service that cannot sign): equal to the secret, compared in
 *  constant time. No secret set is never a match. */
export function tokenOk(got: string | null | undefined, secret: string | null | undefined): boolean {
  return !!secret && typeof got === "string" && sameBytes(got, secret);
}
