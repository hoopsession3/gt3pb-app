import crypto from "crypto";
import { supabaseAdmin } from "./supabaseAdmin";

// APLIIQ integration (0271) — print-on-demand fulfillment for the merch line. Two directions:
// Apliiq calls OUR webhooks (product/search/fulfillment), and we submit orders to THEIR API. Every
// inbound call is HMAC-verified against the shared secret; the secret lives ONLY in env, never in
// code or the repo. Mirrors the Square webhook's signature discipline.

const SECRET = process.env.APLIIQ_SHARED_SECRET || "";
const APP_KEY = process.env.APLIIQ_APP_KEY || "";
const API_BASE = "https://api.apliiq.com/v1";

// Verify an inbound Apliiq webhook. Computes HMAC-SHA256(secret, rawBody) and timing-safe compares
// it to the signature Apliiq sends. The exact header name is confirmed against the first live call
// (their public docs cover the product object, not the webhook envelope) — we accept the couple of
// names Apliiq is known to use and log a miss so it's a one-line adjust, never a silent accept.
// Returns false when no secret is configured — webhooks stay CLOSED until env is set (safe default).
export function verifyApliiq(rawBody: string, headers: Headers): boolean {
  if (!SECRET) return false;
  const provided =
    headers.get("x-apliiq-signature") ||
    headers.get("x-apliiq-hmac-sha256") ||
    (headers.get("x-apliiq-auth") || "").split(":")[1] ||   // "RTS:SIG:APPID:STATE" → SIG
    "";
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// The signed auth header for OUTBOUND calls to Apliiq's API (order submission). Their scheme is
// `x-apliiq-auth RTS:SIG:APPID:STATE` — RTS (request timestamp) + SIG (HMAC of the request) + the
// app id + a state nonce. Built from env; never logs the secret.
function outboundAuthHeader(bodyRaw: string): string {
  const rts = Math.floor(Date.now() / 1000).toString();
  const state = crypto.randomBytes(8).toString("hex");
  const sig = crypto.createHmac("sha256", SECRET).update(rts + bodyRaw + state).digest("base64");
  return `x-apliiq-auth ${rts}:${sig}:${APP_KEY}:${state}`;
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

// Submit a paid merch order to Apliiq for fulfillment. Returns ok + their order id, or the reason it
// failed — the caller drops a failure into the "needs fulfillment" crew queue (money's already
// collected; fulfillment never silently fails). Never throws.
export type ApliiqSubmit = { ok: true; apliiqOrderId: string | null } | { ok: false; error: string };
export async function submitOrderToApliiq(order: {
  id: string;
  ship: { name: string; street: string; city: string; state: string; zip: string };
  items: { apliiq_product_id: string | null; variant: unknown; qty: number }[];
}): Promise<ApliiqSubmit> {
  if (!SECRET || !APP_KEY) return { ok: false, error: "Apliiq not configured (env)" };
  const payload = {
    external_id: order.id,
    shipping: order.ship,
    lineItems: order.items.map((i) => ({ productId: i.apliiq_product_id, variant: i.variant, quantity: i.qty })),
  };
  const raw = JSON.stringify(payload);
  try {
    const r = await fetch(`${API_BASE}/Order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: outboundAuthHeader(raw) },
      body: raw,
    });
    if (!r.ok) return { ok: false, error: `Apliiq ${r.status}` };
    const data = (await r.json().catch(() => ({}))) as { Id?: string | number; id?: string | number };
    const id = data.Id ?? data.id ?? null;
    return { ok: true, apliiqOrderId: id != null ? String(id) : null };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
