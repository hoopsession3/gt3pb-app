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
// Square returns the original payment instead of charging again. The page keeps ONE key per
// checkout (components/useIdemKey) and resends it — with the same card token while the outcome is
// open — so an ambiguous failure (lost response after the card was actually captured) dedupes
// instead of double-charging. If a caller can't supply one (a raw API client, say), we fall back to
// a fresh UUID — that request just isn't retry-safe.
export function safeIdemKey(v: unknown): string {
  return typeof v === "string" && v.length >= 8 && v.length <= 45 ? v : crypto.randomUUID();
}

// WHAT SQUARE'S ANSWER SAYS ABOUT THE MONEY (2026-10-11). Three answers, not two:
//
//   charged   2xx — a payment exists.
//   declined  any other 4xx — Square refused THIS request and nothing was charged by it (a decline,
//             a bad card, an expired or used token, a limit). The page may start over with a new key.
//   unknown   a 5xx (Square's TEMPORARY_ERROR: "You can safely retry your call using the same
//             idempotency key"), a 408 or 409, or IDEMPOTENCY_KEY_REUSED — this key reached Square
//             before with different request data, so an earlier attempt under it may have been charged.
//
// Every non-2xx used to come back as a decline, so a Square 5xx after the card was captured reached
// the page as a 400, the page started over with a fresh key, and the next tap could charge again. An
// unknown answer is now THROWN, like a dropped connection, so it lands in each caller's existing "may
// have been charged" branch instead.
export type ChargeVerdict = "charged" | "declined" | "unknown";

export function chargeVerdict(status: number, data: unknown): ChargeVerdict {
  if (status >= 200 && status < 300) return "charged";
  if (status >= 500 || status === 408 || status === 409) return "unknown";
  // By code, or by the two wordings seen for it: Square's documented "The idempotency key can only be
  // retried with the same request data", and "Different request parameters used for the same
  // idempotency_key" (the cap order, 2026-09-29). Not any mention of the key — TEMPORARY_ERROR's own
  // detail mentions it too.
  const errors = (data as { errors?: { code?: unknown; detail?: unknown }[] } | null)?.errors;
  const reused = Array.isArray(errors) && errors.some((e) => e?.code === "IDEMPOTENCY_KEY_REUSED"
    || /idempotency[ _]key can only be retried|different request parameters used for the same idempotency[ _]key/i.test(String(e?.detail ?? "")));
  return reused ? "unknown" : "declined";
}

/** Square answered, and the answer does not say whether the card was charged. */
export class ChargeUnknown extends Error {
  constructor(message: string) { super(message); this.name = "ChargeUnknown"; }
}

// Square's limit on reference_id (CreatePayment: "Max Length 40"). The pages mint uuids — 36.
const REFERENCE_MAX = 40;

// The one-time-card-charge shape three routes (checkout, delivery checkout, reserve) each built by
// hand: POST /v2/payments with the caller's stable idempotency key, parse the decline vs. success
// shape. Does NOT catch network/parse exceptions — those propagate to the caller's own try/catch
// exactly as they did before this was extracted, so a transient failure still surfaces as the
// caller's existing "Payment service unavailable" 502 rather than silently becoming a 400 "declined"
// through here — and an unknown answer (above) is thrown the same way. (subscriptions/create is a
// different Square flow — customer + card vaulting + subscription — not a single charge, so it isn't
// a candidate for this helper.)
//
// The key also goes on the payment as its reference_id (Square: "A user-defined ID to associate with
// the payment"; the Payment object carries it back), so a charge whose answer was lost can be matched
// to the checkout that made it. ListPayments cannot filter on it, so that match is a read over a time
// window and an amount — done by a person today, from the crew alert that names the key.
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
      ...(opts.idempotencyKey.length <= REFERENCE_MAX ? { reference_id: opts.idempotencyKey } : {}),
      ...(opts.buyerEmail ? { buyer_email_address: opts.buyerEmail } : {}),
    }),
  });
  const data = await res.json();
  const verdict = chargeVerdict(res.status, data);
  if (verdict === "charged") return { ok: true, paymentId: data?.payment?.id ?? null };
  if (verdict === "unknown") {
    const said = String(data?.errors?.[0]?.code || data?.errors?.[0]?.detail || "");
    throw new ChargeUnknown(`Square answered ${res.status}${said ? ` (${said})` : ""}`);
  }
  return { ok: false, error: data?.errors?.[0]?.detail || "Payment declined" };
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
