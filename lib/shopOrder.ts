// SHOP ORDER — the vocabulary of a storefront order's life, in one place.
//
// The database owns the RULES (0313's set_shop_order_status enforces which moves are legal, and
// refuses the rest with a sentence a person can read). This module owns the WORDS: what each stage
// means, who it is waiting on, what the button should say, and what the crew is being asked to
// confirm. Those two lists have to agree, so FLOW below is a mirror of the function's `legal` array
// and scripts/db.shoporder.test.mjs asserts the database's half; if they ever drift, the database
// wins and the screen shows its refusal rather than pretending.
//
// Pure and dependency-free on purpose, so scripts/smoke.cjs can exercise every branch without a
// browser, a database or a fixture. Same shape as lib/operatorDeal.ts.

export const SHOP_STATUSES = [
  "paid", "needs_fulfillment", "submitted", "in_production", "shipped", "delivered",
  "refunded", "canceled",
] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const isShopStatus = (v: unknown): v is ShopStatus =>
  typeof v === "string" && (SHOP_STATUSES as readonly string[]).includes(v);

/** Who the order is sitting with. The crew only ever needs to act on "us". */
export type WaitingOn = "us" | "printer" | "carrier" | "nobody";

type StatusMeta = {
  label: string;
  /** What this stage actually means, in the crew's words rather than the schema's. */
  means: string;
  waiting: WaitingOn;
};

export const SHOP_STATUS_META: Record<ShopStatus, StatusMeta> = {
  paid: {
    label: "Paid",
    means: "The card cleared. Nothing has been sent to the printer yet.",
    waiting: "us",
  },
  needs_fulfillment: {
    label: "Needs fulfilment",
    means: "Paid, and the printer either wasn't reachable or hasn't been asked. Submit it by hand.",
    waiting: "us",
  },
  submitted: {
    label: "Sent to printer",
    means: "Apliiq has it. Nothing for us to do unless it stalls.",
    waiting: "printer",
  },
  in_production: {
    label: "In production",
    means: "Being printed. Too late to change the garment or the address.",
    waiting: "printer",
  },
  shipped: {
    label: "Shipped",
    means: "On its way, with tracking. The customer already got the email.",
    waiting: "carrier",
  },
  delivered: {
    label: "Delivered",
    means: "The carrier says it arrived. Nothing further unless the customer says otherwise.",
    waiting: "nobody",
  },
  refunded: {
    label: "Refunded",
    means: "The money went back — in Square. This is the record of it, not the act.",
    waiting: "nobody",
  },
  canceled: {
    label: "Cancelled",
    means: "Stopped before it shipped. If it was paid, the money still has to go back.",
    waiting: "nobody",
  },
};

/**
 * A mirror of set_shop_order_status's `legal` (0313). The database is the enforcer; this is so the
 * screen offers only the moves that will succeed instead of finding out by being refused.
 *
 * 'canceled' → 'refunded' is here for the same reason it is there: every shop order is charged
 * before its row exists, so a cancelled order that can never be refunded is a dead end with
 * somebody else's money in it.
 */
export const SHOP_FLOW: Record<ShopStatus, readonly ShopStatus[]> = {
  paid: ["needs_fulfillment", "submitted", "canceled", "refunded"],
  needs_fulfillment: ["submitted", "shipped", "canceled", "refunded"],
  submitted: ["in_production", "shipped", "canceled", "refunded"],
  in_production: ["shipped", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  canceled: ["refunded"],
  refunded: [],
};

export const nextStatuses = (from: string | null | undefined): ShopStatus[] =>
  isShopStatus(from) ? [...SHOP_FLOW[from]] : [];

export const canMove = (from: string | null | undefined, to: string | null | undefined): boolean =>
  isShopStatus(from) && isShopStatus(to) && SHOP_FLOW[from].includes(to);

export const isTerminal = (s: string | null | undefined): boolean =>
  isShopStatus(s) && SHOP_FLOW[s].length === 0;

export const waitingOn = (s: string | null | undefined): WaitingOn =>
  isShopStatus(s) ? SHOP_STATUS_META[s].waiting : "us";

export const statusLabel = (s: string | null | undefined): string =>
  isShopStatus(s) ? SHOP_STATUS_META[s].label : (s || "Unknown");

/** The verb on the button. "Mark shipped" reads as a claim; "Send to printer" reads as an act. */
const VERBS: Record<ShopStatus, string> = {
  paid: "Mark paid",
  needs_fulfillment: "Send back to the queue",
  submitted: "Mark sent to printer",
  in_production: "Mark in production",
  shipped: "Mark shipped",
  delivered: "Mark delivered",
  refunded: "Record a refund",
  canceled: "Cancel the order",
};
export const moveVerb = (to: string | null | undefined): string =>
  isShopStatus(to) ? VERBS[to] : "Update";

/**
 * The two moves that cost a customer something need a typed reason — the same rule as void_expense
 * and the 0309 voids, and the database refuses without one, so the screen must ask for it first.
 */
export const needsReason = (to: string | null | undefined): boolean =>
  to === "refunded" || to === "canceled";

/**
 * What the crew is actually agreeing to. This exists because /api/orders/cancel once told customers
 * "your refund is on the way" when all it had done was raise a staff alert — the app cannot move
 * money, and every screen that implies otherwise is writing a cheque somebody else has to honour.
 */
export const moveWarning = (to: string | null | undefined): string | null => {
  if (to === "refunded") {
    return "This records a refund. It does not issue one — card data never touches this app. Refund it in Square first, then log it here.";
  }
  if (to === "canceled") {
    return "This stops the order on our side. It does not cancel it at the printer and it does not return the money — do both of those yourself, then come back.";
  }
  if (to === "submitted") {
    return "Only tick this once Apliiq actually has the order. It is a claim about their system, not a request to it.";
  }
  return null;
};

// ── money and shape ──────────────────────────────────────────────────────────────────────────────

// The canonical formatter lives in lib/money. Re-exported, not copied — these two files
// carried byte-identical copies of it, which is how the app ended up with thirty.
export { money } from "./money";

/**
 * Margin as a percentage of what was charged. Null in, null out — an order whose lines carry no
 * cost has an UNKNOWN margin, and 0313's view already refuses to invent one. Repeating that refusal
 * here rather than defaulting to 0 is the whole point: a margin computed from an unknown cost is a
 * wrong number that looks like a right one.
 */
export const marginPct = (marginCents: number | null | undefined, totalCents: number | null | undefined): number | null => {
  if (marginCents == null || totalCents == null) return null;
  const t = Number(totalCents);
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.round((Number(marginCents) / t) * 100);
};

export type ShipAddress = { street?: string | null; city?: string | null; state?: string | null; zip?: string | null };

/** One line, in the order an envelope reads. Missing pieces are dropped, not printed as "null". */
export const shipLine = (a: unknown): string => {
  if (!a || typeof a !== "object") return "";
  const x = a as ShipAddress;
  const cityState = [x.city, x.state].map((v) => (v ?? "").toString().trim()).filter(Boolean).join(", ");
  return [(x.street ?? "").toString().trim(), cityState, (x.zip ?? "").toString().trim()]
    .filter(Boolean).join(" · ");
};

/**
 * "3 days", "6h", "just now" — the age of an order, said the way a person would say it.
 *
 * The null check is explicit and comes FIRST, because Number(null) is 0, which is finite and not
 * negative, and would have made an order with no age read as "just now". The smoke test caught it;
 * a screen would have shown a confident lie about the one number this queue is sorted on.
 */
export const ageLabel = (hours: number | null | undefined): string => {
  if (hours == null) return "";
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0) return "";
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
};

/**
 * The line the queue leads with. Deliberately says nothing when nothing is owed — a dashboard that
 * always has a number on it trains people to stop reading the number.
 */
export function queueHeadline(q: { on_us?: number | null; oldest_on_us_hours?: number | null } | null | undefined): string {
  const n = Number(q?.on_us ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "Nothing waiting on us.";
  const age = ageLabel(q?.oldest_on_us_hours);
  const what = n === 1 ? "1 order is waiting on us" : `${n} orders are waiting on us`;
  return age ? `${what} — the oldest for ${age}.` : `${what}.`;
}

/** Square is where a refund actually happens; the door belongs next to the button that logs it. */
export const SQUARE_TRANSACTIONS = "https://squareup.com/dashboard/sales/transactions";
