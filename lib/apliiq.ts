import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { buildOrderPayload, type OrderLine, type OrderShip } from "./apliiqOrder";
import { errorMessage } from "./errorMessage";
import { apliiqSignatureOk } from "./webhookSignature";

// APLIIQ integration (0271) — print-on-demand fulfillment for the merch line. Two directions:
// Apliiq calls OUR webhooks (product/search/fulfillment), and we submit orders to THEIR API. Every
// inbound call is HMAC-verified against the shared secret; the secret lives ONLY in env, never in
// code or the repo. Mirrors the Square webhook's signature discipline.

const SECRET = process.env.APLIIQ_SHARED_SECRET || "";
const APP_KEY = process.env.APLIIQ_APP_KEY || "";
const API_BASE = "https://api.apliiq.com/v1";

// Verify an inbound Apliiq call against their documented HMAC scheme. Apliiq authenticates with an
//   Authorization: x-apliiq-auth  RTS:SIG:APPID:STATE
// header, where SIG = base64( HMAC-SHA256( APPID + RTS + STATE + base64(body), shared_secret ) ).
// We re-derive SIG from the parts they send (APPID/RTS/STATE + the raw body we received) and
// timing-safe compare. Returns false when no secret is configured — inbound calls stay CLOSED until
// the env is set (safe default). The signed string is faithful to Apliiq's Authentication Guide.
// The check is lib/webhookSignature's apliiqSignatureOk since 2026-10-11 — one home for every webhook's
// signature, run against made-up secrets by scripts/webhooks.test.mjs.
export function verifyApliiq(rawBody: string, headers: Headers): boolean {
  // Accept the token whether it arrives under Authorization (with the scheme word) or a bare header.
  return apliiqSignatureOk(rawBody, headers.get("authorization") || headers.get("x-apliiq-auth"), SECRET);
}

// The signed auth header for OUTBOUND calls to Apliiq's API. Per their Authentication Guide the value
// is `x-apliiq-auth RTS:SIG:APPID:STATE`, where
//   RTS   = request timestamp (unix seconds)
//   STATE = a random per-request nonce
//   SIG   = base64( HMAC-SHA256( APPID + RTS + STATE + base64(body), shared_secret ) )
// A GET (or any empty body) signs base64("") = "". Built from env; never logs the secret.
function outboundAuthHeader(bodyRaw: string): string {
  const rts = Math.floor(Date.now() / 1000).toString();
  const state = crypto.randomBytes(8).toString("hex");
  const b64 = bodyRaw ? Buffer.from(bodyRaw).toString("base64") : "";
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(APP_KEY + rts + state + b64)
    .digest("base64");
  return `x-apliiq-auth ${rts}:${sig}:${APP_KEY}:${state}`;
}

// Authenticated GET against Apliiq's API (e.g. "/Product" to list the catalog, "/Product/:id" for
// one). Empty body → the signed base64(body) is "". Returns parsed JSON; throws on a non-2xx so the
// caller can surface the status. Never throws the secret into a message.
export async function apliiqGet(path: string): Promise<unknown> {
  if (!SECRET || !APP_KEY) throw new Error("Apliiq not configured (env)");
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: outboundAuthHeader("") },
  });
  if (!r.ok) throw new Error(`Apliiq GET ${path} → ${r.status}`);
  return r.json();
}

// Idempotency gate: record a provider event once. Returns true if THIS is the first time we've seen
// it (proceed), false if it's a replay (skip — a retried webhook must never double-act). REUSES the
// existing 0230 inbox (public.webhook_events, id = the provider event id) rather than a second
// ledger — we namespace the id as `<provider>:<event>` so Apliiq and Square ids can never collide,
// and the primary-key clash on re-insert IS the dedup. One inbox, both providers.
export async function firstSeen(provider: "apliiq" | "square", eventId: string): Promise<boolean> {
  if (!supabaseAdmin || !eventId) return true;
  // type = the leading token of our namespaced event id (product|search|fulfil|…) for a readable inbox.
  const type = eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : provider;
  const { error } = await supabaseAdmin
    .from("webhook_events")
    .insert({ id: `${provider}:${eventId}`, provider, type });
  // unique-violation (23505) on the primary key = we've processed this event before → not first-seen.
  return !(error && (error as { code?: string }).code === "23505");
}

/** Give an event back (R8): marked seen as it arrived, and its processing failed — so the sender's retry is processed,
 *  not answered "deduped" with the work undone (a shipped order that never read shipped, a tracking email never sent). */
export async function forgetSeen(provider: "apliiq" | "square", eventId: string): Promise<void> {
  if (!supabaseAdmin || !eventId) return;
  // scoped-by: the inbox's own primary key, this event's — the row firstSeen wrote a moment ago
  await supabaseAdmin.from("webhook_events").delete().eq("id", `${provider}:${eventId}`);
}

/** An inbox key from the signed body itself (R9, 2026-10-16). The routes keyed their inbox row on x-apliiq-delivery when
 *  it came — a header outside the signature, so a captured call sent again with a new one was processed again. The same
 *  bytes give the same key; nothing outside the signature changes it. */
export function bodyKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

// Submit a paid merch order to Apliiq for fulfillment. Returns ok + their order id, or the reason it
// failed — the caller drops a failure into the "needs fulfillment" crew queue (money's already
// collected; fulfillment never silently fails). Never throws.
//
// REWRITTEN 2026-09-28 against Apliiq's published Create Order schema, which this had never once
// been checked against. EVERY field was wrong: external_id for id (and no number/name/order_number
// at all), shipping for shipping_address, a single `name` where first_name AND last_name are
// required, no country or country_code, lineItems for line_items, and productId where a per-size
// `sku` ("APQ-########S#A#") is required — plus no per-line id, title or price. A paid order would
// have been rejected outright. lib/apliiqOrder builds and validates the body; this signs and posts.
// ── ok:true WITH NO ID WAS A REPRESENTABLE STATE (2026-09-30) ──────────────────────────────────
// It used to read `{ ok: true; apliiqOrderId: string | null }`, and checkout wrote
// `status = 'submitted'` on any `submit.ok`. So a 2xx whose body we could not read — empty, a
// different field name, an HTML error page served with 200 — set the status whose own definition
// (lib/shopOrder) is "We sent it and Apliiq's API returned an id."
//
// That is what happened to the first cap: shop_orders holds status='submitted' with
// apliiq_order_id NULL. The sentence 0329 wrote to stop this app overstating itself was overstating
// itself, on the only real order in the database.
//
// The id is not a nice-to-have. /api/apliiq/fulfillment matches their callbacks on
// apliiq_order_id, so a null one cannot ever be joined: the order could not hear back even if
// Apliiq did something. Success now REQUIRES the id, so "we have no idea whether they took it"
// lands in the crew queue with a reason instead of wearing the word for its opposite.
//
// ── NOT TAKEN IS NOT THE SAME AS NO ANSWER (R9, 2026-10-16 — 0417) ─────────────────────────────
// Every failure read as "not sent": a timeout, a dropped connection, a 5xx, a 2xx with no id. The
// claim aged out in two minutes and Send to printer was offered again — a second cap, on the
// business card, whenever Apliiq had in fact taken the first. Now a failure says which it is:
//   refused  (unclear absent) — Apliiq said no, or it never reached them: nothing there; send again
//            once the reason is fixed.
//   unclear  (unclear: true)  — it may have reached them and no clear answer came back: Apliiq may
//            have it. The order waits for the crew to look (0417, apliiq_submit_unknown_at).
export type ApliiqSubmit =
  | { ok: true; apliiqOrderId: string }
  | { ok: false; error: string; unclear?: false }
  | { ok: false; error: string; unclear: true };

/** How long a send waits for Apliiq: longer than any round trip they need, well inside the two-minute claim (0335). */
export const APLIIQ_SUBMIT_TIMEOUT_MS = 25_000;

/** A connection that never opened: no address, refused, unreachable, no secure channel. The request cannot have reached
 *  Apliiq. Everything else that throws — a timeout, a reset mid-request — may have. */
const NEVER_REACHED = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
function neverReached(e: unknown): boolean {
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" && NEVER_REACHED.has(cause.code);
}

/** A status Apliiq answered with that says it did not take the order: a refusal of the request itself. 408 (it gave up
 *  waiting) and 409 (a conflict — it may already hold this order) are not that, nor is any 5xx. */
const refusedStatus = (s: number) => s >= 400 && s < 500 && s !== 408 && s !== 409;

export async function submitOrderToApliiq(order: {
  id: string;
  ship: OrderShip;
  items: OrderLine[];
}, fetcher: typeof fetch = fetch): Promise<ApliiqSubmit> {
  if (!SECRET || !APP_KEY) return { ok: false, error: "Apliiq not configured (env)" };
  // Refuse rather than post something Apliiq will reject. The crew queue then carries a reason a
  // human can act on — "no Apliiq SKU for: 6-Panel Cap" — instead of a bare 400.
  const built = buildOrderPayload(order);
  if (!built.ok) return { ok: false, error: built.reason };
  const raw = JSON.stringify(built.payload);
  let r: Response;
  try {
    r = await fetcher(`${API_BASE}/Order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: outboundAuthHeader(raw) },
      body: raw,
      signal: AbortSignal.timeout(APLIIQ_SUBMIT_TIMEOUT_MS),
    });
  } catch (e) {
    if (neverReached(e)) return { ok: false, error: `Apliiq couldn't be reached — ${errorMessage(e, 100)}` };
    return { ok: false, unclear: true, error: `no answer from Apliiq — ${errorMessage(e, 100)}` };
  }
  if (!r.ok) {
    // Their message, not just the number — the first real order is how this contract gets
    // confirmed, and "Apliiq 400" tells whoever reads the alert nothing about which field.
    const detail = await r.text().catch(() => "");
    const error = `Apliiq ${r.status}${detail ? ` — ${detail.slice(0, 90)}` : ""}`;
    return refusedStatus(r.status) ? { ok: false, error } : { ok: false, unclear: true, error };
  }
  const data = (await r.json().catch(() => ({}))) as { Id?: string | number; id?: string | number };
  const id = data?.Id ?? data?.id ?? null;
  const idStr = id == null ? "" : String(id).trim();
  // A 2xx we cannot read is not an acceptance — and not a refusal either: Apliiq answered yes to
  // something. Unclear, so the order waits for someone to look before it can be sent again.
  if (!idStr) return { ok: false, unclear: true, error: `Apliiq ${r.status} but no order id in the reply — it may have the order` };
  return { ok: true, apliiqOrderId: idStr };
}
