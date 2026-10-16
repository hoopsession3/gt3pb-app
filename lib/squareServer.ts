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

// Square's limit on reference_id (CreatePayment: "Max Length 40"). The pages mint uuids — 36. A key longer than this
// goes without a reference, so nothing can match a payment to it (lib/reservePay.settleByHand asks only when it fits).
export const REFERENCE_MAX = 40;

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
/** The card a payment was made with, as a receipt says it ("Visa ··4242", R3b — 0395): its brand and last four, never
 *  more of it. Square's VISA / MASTERCARD / AMERICAN_EXPRESS read as words. */
export type PaidCard = { brand: string | null; last4: string | null };
export function paidCard(c: { card_brand?: unknown; last_4?: unknown } | null | undefined): PaidCard | null {
  if (!c) return null;
  const last4 = typeof c.last_4 === "string" && /^\d{4}$/.test(c.last_4) ? c.last_4 : null;
  const raw = typeof c.card_brand === "string" ? c.card_brand : "";
  const brand = ({ VISA: "Visa", MASTERCARD: "Mastercard", AMERICAN_EXPRESS: "Amex", DISCOVER: "Discover", DISCOVER_DINERS: "Diners", JCB: "JCB",
    CHINA_UNIONPAY: "UnionPay", SQUARE_GIFT_CARD: "Gift card", INTERAC: "Interac", EFTPOS: "eftpos", FELICA: "FeliCa", EBT: "EBT" } as Record<string, string>)[raw] ?? (raw ? "Card" : null);
  return last4 ? { brand, last4 } : null;
}

export async function chargeCard(opts: {
  token: string; locationId: string; sourceId: string; amountCents: number; note: string; idempotencyKey: string;
  // Square emails the buyer a receipt when this is present (2026-08-01 enterprise round P3) —
  // optional, so guest checkouts without an account email charge exactly as before.
  buyerEmail?: string | null;
}): Promise<{ ok: true; paymentId: string | null; card?: PaidCard | null } | { ok: false; error: string }> {
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
  if (verdict === "charged") return { ok: true, paymentId: data?.payment?.id ?? null, card: paidCard(data?.payment?.card_details?.card) };
  if (verdict === "unknown") {
    const said = String(data?.errors?.[0]?.code || data?.errors?.[0]?.detail || "");
    throw new ChargeUnknown(`Square answered ${res.status}${said ? ` (${said})` : ""}`);
  }
  return { ok: false, error: refusalWords(res.status, data) };
}

/** What a refused card is told, at every card door. */
export const DECLINE_WORDS = "Your card was declined — nothing was charged. Check its details, or try another card.";
export const CARD_ENTRY_WORDS = "That card entry expired — enter the card again. Nothing was charged.";
export const SQUARE_DOWN_WORDS = "Card payments aren't working just now — nothing was charged. Try again in a moment.";

/** ONE SENTENCE FOR EVERY DECLINE (R9 — the abuse audit's fifth). Square's own reason — a security code that didn't
 *  match, a ZIP, insufficient funds, an expired card — went back to the page as it came, and so to anyone calling a card
 *  door with a script: which stolen numbers were good, and what each still needed. A card's refusal is one sentence now.
 *  A refusal that is not the card's (R9 review) — the access token, the location, a malformed request — is not called a
 *  decline: it would read as every customer's card failing. The person paying is told payments aren't working; the
 *  crew are told what Square said, once a reason (sayRefusal). Pure but for that. */
export function refusalWords(status: number, data: unknown): string {
  const e = (data as { errors?: { category?: unknown; code?: unknown; detail?: unknown }[] } | null)?.errors?.[0];
  const category = String(e?.category ?? ""), code = String(e?.code ?? "");
  if (category === "PAYMENT_METHOD_ERROR") return DECLINE_WORDS;
  if (/^CARD_TOKEN_(EXPIRED|USED)$|^INVALID_CARD_DATA$|^CARD_EXPIRED$|^INVALID_EXPIRATION/.test(code)) return CARD_ENTRY_WORDS;
  sayRefusal(status, code || category || "no code", String(e?.detail ?? ""));
  return SQUARE_DOWN_WORDS;
}

/** A refusal that is not the card's, said where the crew read it — in the running app only (a test compiles this file
 *  alone), once a reason while it is open. Never throws. */
function sayRefusal(status: number, code: string, detail: string): void {
  console.error(`[square] a charge was refused, and not for the card: ${status} ${code} ${detail.slice(0, 200)}`);
  if (typeof process === "undefined" || !process.env.NEXT_RUNTIME) return;
  void import("./serverAlerts").then((m) => m.raiseAlertOnce({
    severity: "critical", category: "money", kind: "square_refused", subjectId: `square:${code}`,
    title: "Square is refusing card payments — not the cards",
    body: `Square answered ${status} (${code}) to a card payment: ${detail.slice(0, 160) || "no detail"}. Customers are told payments aren't working. Check the Square access token and location in the deploy's settings.`,
    link: "/crew?s=money&a=pay",
  })).catch(() => { /* the log line above stands */ });
}

/** Square answered a refund, and the answer does not say whether the money went back. */
export class RefundUnknown extends Error {
  constructor(message: string) { super(message); this.name = "RefundUnknown"; }
}

// Square's limit on a refund's reason (RefundPayment: "Max Length 192").
const REASON_MAX = 192;

// MONEY GOING BACK (2026-10-12, 0388 — a pack changed to a cheaper one, lib/packChange). POST /v2/refunds, part or all
// of one payment, under a key the caller keeps for this refund alone. The same three answers as a charge
// (chargeVerdict): made, refused (any other 4xx: nothing went back), and unknown (a 5xx, a 408 or 409,
// IDEMPOTENCY_KEY_REUSED) — thrown, like a dropped connection, so the caller's "not confirmed" branch takes it. Square
// answers a refund PENDING and completes it on its own, so PENDING is a refund made; REJECTED or FAILED in the answer
// is a refusal.
export async function refundPayment(opts: {
  token: string; paymentId: string; amountCents: number; idempotencyKey: string; reason: string;
}): Promise<{ ok: true; refundId: string | null; status: string } | { ok: false; error: string }> {
  const res = await fetch(`${SQUARE_BASE}/v2/refunds`, {
    method: "POST",
    headers: squareHeaders(opts.token),
    body: JSON.stringify({
      idempotency_key: opts.idempotencyKey,
      payment_id: opts.paymentId,
      amount_money: { amount: opts.amountCents, currency: "USD" },
      reason: opts.reason.slice(0, REASON_MAX),
    }),
  });
  const data = await res.json();
  const verdict = chargeVerdict(res.status, data);
  if (verdict === "unknown") {
    const said = String(data?.errors?.[0]?.code || data?.errors?.[0]?.detail || "");
    throw new RefundUnknown(`Square answered ${res.status}${said ? ` (${said})` : ""}`);
  }
  if (verdict === "declined") return { ok: false, error: data?.errors?.[0]?.detail || "Refund refused" };
  const status = String(data?.refund?.status ?? "PENDING");
  if (status === "REJECTED" || status === "FAILED") return { ok: false, error: `Square ${status.toLowerCase()} the refund` };
  return { ok: true, refundId: data?.refund?.id ?? null, status };
}

// ONE PAYMENT, AS SQUARE KEEPS IT (2026-10-14, 0400). GET /v2/payments/{id}: its status, the reference it was made under
// (chargeCard sets the checkout's key there), its amount and what has been refunded of it — a refunded payment stays
// COMPLETED in Square, with refunded_money beside it. An owner settling a Limited Reserve whose answer was lost is checked
// against this before anything is believed (lib/reservePay settleByHand): a payment that is not this checkout's, or not
// completed, is not marked paid, and what it is marked paid with is what is still taken. 404: no such payment. Throws on
// a dropped connection, like the others.
export async function getPayment(opts: { token: string; paymentId: string }): Promise<
  { ok: true; status: string; referenceId: string | null; amountCents: number; refundedCents: number } | { ok: false; notFound: boolean; error: string }
> {
  const res = await fetch(`${SQUARE_BASE}/v2/payments/${encodeURIComponent(opts.paymentId)}`, { headers: squareHeaders(opts.token) });
  const data = await res.json().catch(() => null);
  const p = data?.payment;
  if (res.status >= 200 && res.status < 300 && p) {
    return { ok: true, status: String(p.status ?? ""), referenceId: typeof p.reference_id === "string" ? p.reference_id : null,
      amountCents: Number(p.amount_money?.amount) || 0, refundedCents: Number(p.refunded_money?.amount) || 0 };
  }
  return { ok: false, notFound: res.status === 404, error: String(data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square answered ${res.status}`) };
}

// A PAYMENT FOUND BY THE KEY IT WAS MADE UNDER (2026-10-14, 0400). ListPayments cannot filter on reference_id, so this
// reads the location's payments over the window a checkout ran in and matches the reference: a checkout asks Square once
// under its key (lib/chargeOnce never asks again), so its payment, if there is one, was made inside that window. Several
// under one reference (a failed try, then none) — the one that took money first. Five pages of 100 at most; more than
// that in a few minutes is not a window this can read, and it says so rather than calling it "none" — as it does an
// answer it cannot read (a 2xx cut off mid-body is not "no payments"). Square leaves `payments` out when there are none.
export type FoundPayment = { id: string; status: string; amountCents: number; refundedCents: number };
export async function findPaymentByReference(opts: {
  token: string; locationId: string; reference: string; fromIso: string; toIso: string;
}): Promise<{ ok: true; payment: FoundPayment | null } | { ok: false; error: string }> {
  const hits: FoundPayment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ begin_time: opts.fromIso, end_time: opts.toIso, location_id: opts.locationId, sort_order: "ASC", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${SQUARE_BASE}/v2/payments?${q.toString()}`, { headers: squareHeaders(opts.token) });
    const data = await res.json().catch(() => null);
    if (!(res.status >= 200 && res.status < 300)) return { ok: false, error: String(data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square answered ${res.status}`) };
    if (!data || typeof data !== "object" || ("payments" in data && !Array.isArray(data.payments))) return { ok: false, error: "an answer that could not be read" };
    type Listed = { id?: unknown; status?: unknown; reference_id?: unknown; amount_money?: { amount?: unknown }; refunded_money?: { amount?: unknown } };
    for (const p of (Array.isArray(data.payments) ? data.payments : []) as Listed[]) {
      if (p?.reference_id === opts.reference && typeof p.id === "string") {
        hits.push({ id: p.id, status: String(p.status ?? ""), amountCents: Number(p.amount_money?.amount) || 0, refundedCents: Number(p.refunded_money?.amount) || 0 });
      }
    }
    cursor = typeof data?.cursor === "string" && data.cursor ? data.cursor : undefined;
    if (!cursor) {
      const took = hits.find((h) => h.status !== "FAILED" && h.status !== "CANCELED");
      return { ok: true, payment: took ?? hits[0] ?? null };
    }
  }
  return { ok: false, error: "more payments in that window than can be read" };
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
