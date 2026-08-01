// Server-only Square REST helpers (the access token never leaves the server).
// Environment follows the APP ID's own prefix (see lib/square.ts SQUARE_ENV) — the app ID decides
// where nonces are minted, so the charge must go to the same side. The old NEXT_PUBLIC_SQUARE_ENV
// switch could disagree with the app ID, which is exactly the "Card nonce not found in this
// application environment" Ryan hit live (sandbox app ID tokenizing, production base charging).
export const SQUARE_BASE =
  (process.env.NEXT_PUBLIC_SQUARE_APP_ID || "").startsWith("sandbox-")
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

export const SQUARE_VERSION = "2025-01-23";

export function squareHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION,
  };
}

// A Square idempotency key must be a stable string (≤45 chars for Payments) that is REUSED across
// every retry of the same logical charge — that's the whole mechanism: replay the same key and
// Square returns the original payment instead of charging again. The client generates one key per
// checkout attempt and resends it verbatim on "Try again", so an ambiguous failure (lost response
// after the card was actually captured) dedupes instead of double-charging. If a caller can't supply
// one (a raw API client, say), we fall back to a fresh UUID — that request just isn't retry-safe.
export function safeIdemKey(v: unknown): string {
  return typeof v === "string" && v.length >= 8 && v.length <= 45 ? v : crypto.randomUUID();
}

// The one-time-card-charge shape three routes (checkout, delivery checkout, reserve) each built by
// hand: POST /v2/payments with the caller's stable idempotency key, parse the decline vs. success
// shape. Does NOT catch network/parse exceptions — those propagate to the caller's own try/catch
// exactly as they did before this was extracted, so a transient failure still surfaces as the
// caller's existing "Payment service unavailable" 502 rather than silently becoming a 400 "declined"
// through here. (subscriptions/create is a different Square flow — customer + card vaulting +
// subscription — not a single charge, so it isn't a candidate for this helper.)
export async function chargeCard(opts: {
  token: string; locationId: string; sourceId: string; amountCents: number; note: string; idempotencyKey: string;
  // Square emails the buyer a receipt when this is present (2026-08-01 enterprise round P3) —
  // optional, so guest checkouts without an account email charge exactly as before.
  buyerEmail?: string | null;
}): Promise<{ ok: true; paymentId: string | null } | { ok: false; error: string }> {
  const res = await fetch(`${SQUARE_BASE}/v2/payments`, {
    method: "POST",
    headers: squareHeaders(opts.token),
    body: JSON.stringify({
      source_id: opts.sourceId,
      idempotency_key: opts.idempotencyKey,
      amount_money: { amount: opts.amountCents, currency: "USD" },
      location_id: opts.locationId,
      note: opts.note,
      ...(opts.buyerEmail ? { buyer_email_address: opts.buyerEmail } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.errors?.[0]?.detail || "Payment declined" };
  return { ok: true, paymentId: data?.payment?.id ?? null };
}

// One Square Subscription Plan Variation per coffee pack (6 / 12 / 18). The owner
// creates three plan variations in Square (each with its cadence + price) and sets these.
export const SQUARE_PLAN_BY_PACK: Record<string, string> = {
  "6": process.env.SQUARE_SUB_PLAN_6 || "",
  "12": process.env.SQUARE_SUB_PLAN_12 || "",
  "18": process.env.SQUARE_SUB_PLAN_18 || "",
};
export function planForPack(pack: string): string {
  return SQUARE_PLAN_BY_PACK[pack] || "";
}
export const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
export const SQUARE_WEBHOOK_URL = process.env.SQUARE_WEBHOOK_URL || "";

export function subsConfigured() {
  const anyPlan = SQUARE_PLAN_BY_PACK["6"] || SQUARE_PLAN_BY_PACK["12"] || SQUARE_PLAN_BY_PACK["18"];
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID && anyPlan);
}

// Map Square subscription status -> our mirror enum.
export function mapSubStatus(s?: string): "pending" | "active" | "paused" | "canceled" {
  switch ((s || "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "PAUSED": return "paused";
    case "CANCELED":
    case "DEACTIVATED": return "canceled";
    default: return "pending";
  }
}
