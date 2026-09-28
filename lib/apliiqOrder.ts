import { moneyPlain } from "./money";
// THE ORDER WE SEND APLIIQ — pure, so it can be tested without a network or a database.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────────
// lib/apliiq.ts's submitOrderToApliiq was written from a guess and has never placed a real order.
// On 2026-09-28 Ryan opened the "product skus" panel on an Apliiq design and it showed the real
// orderable identity:
//
//     s     APQ-5902678S6A1          xl    APQ-5902678S1A1
//     m     APQ-5902678S7A1          xxl   APQ-5902678S2A1
//     l     APQ-5902678S8A1          xxxl  APQ-5902678S21A1
//
// A SKU PER SIZE. Not a product id with a variant hanging off it. Apliiq's Create Order doc then
// confirmed the whole schema, and every single field we were sending was wrong:
//
//     we sent                        Apliiq requires
//     ───────────────────────────    ────────────────────────────────────────────────
//     external_id                    id  (+ number, name, order_number — all missing)
//     shipping                       shipping_address
//     shipping.name (one field)      first_name AND last_name
//     shipping.street                address1
//     shipping.state                 province AND province_code
//     — (absent)                     country AND country_code
//     lineItems                      line_items
//     lineItems[].productId          line_items[].sku   ("APQ-########S#A#")
//     — (absent)                     line_items[].id, .title/.name, .price
//
// So a paid order would have been rejected outright. Not silently — checkout already drops a
// failed submit into the crew "needs fulfillment" queue with an alert, so no money was ever at
// risk — but it would never once have shipped a garment.
//
// The functions below are deliberately free of imports so scripts/smoke can compile and exercise
// them directly. A fulfilment payload assembled by a function nobody can run is how this got here.

/** Apliiq's documented SKU shape: APQ-<product digits><size code><suffix>, e.g. APQ-5902678S6A1. */
export const SKU_RE = /^APQ-\d+S\d+A\d+$/i;

export type ApliiqVariant = { size?: string; color?: string; sku?: string; apliiq_variant_id?: string };

/** Normalise a size/colour label for comparison — "XL", "xl", " X-L " all mean the same rack. */
const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/[\s._-]/g, "");

/**
 * Which SKU does this customer's choice correspond to?
 *
 * `chosen` is whatever the storefront put in the cart line — normally `{ size: "L" }`, sometimes
 * `{ size, color }`, sometimes a bare string, sometimes null when the product has one option.
 * Returns null rather than a wrong SKU: shipping somebody an XXL because the match was fuzzy is
 * worse than landing the order in the crew queue with a reason.
 */
export function skuFor(variants: ApliiqVariant[] | null | undefined, chosen: unknown): string | null {
  const list = (Array.isArray(variants) ? variants : []).filter((v) => v && typeof v === "object");
  const withSku = list.filter((v) => typeof v.sku === "string" && SKU_RE.test(v.sku.trim()));
  if (withSku.length === 0) return null;

  // A product with exactly ONE orderable SKU has no ambiguity to resolve — a one-size cap, a
  // tumbler. The customer's choice cannot disagree with a set of one.
  if (withSku.length === 1) return withSku[0].sku!.trim();

  const want = chosen && typeof chosen === "object" ? (chosen as Record<string, unknown>) : null;
  const wantSize = norm(want?.size ?? (typeof chosen === "string" ? chosen : ""));
  const wantColor = norm(want?.color);
  if (!wantSize && !wantColor) return null;          // several SKUs and nothing to pick with

  // EXACTLY ONE, or nothing. This used .find(), which returns the FIRST match — and on the cap
  // that is a wrong-garment bug rather than a near miss: every colorway of the five-panel cap is
  // labelled "adjustable" and each has its own SKU (APQ-5888205S87A1 for natural/red,
  // APQ-5888216S87A1 for another), so "adjustable" matches several and .find() would have picked
  // whichever was pasted first. The customer orders red and a different hat arrives. Ambiguity is
  // a refusal — the crew queue is recoverable, a shipped wrong colour is not.
  const hits = withSku.filter((v) =>
    (!wantSize || norm(v.size) === wantSize) &&
    (!wantColor || norm(v.color) === wantColor));
  return hits.length === 1 ? hits[0].sku!.trim() : null;
}

/**
 * One shipping name into the two fields Apliiq requires.
 *
 * Checkout collects a single "full shipping name" box, because that is what a person types. The
 * last whitespace run is the split: "Ryan Thompkins" → Ryan / Thompkins, "Mary Anne Del Rio" →
 * "Mary Anne" / "Del Rio" is wrong in the general case and right far more often than splitting on
 * the FIRST space. A single word puts everything in last_name, which is what carriers want when
 * there is only one name on the parcel.
 */
export function splitName(full: string): { first_name: string; last_name: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: "", last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

export type OrderLine = { id: string; title: string; qty: number; priceCents: number; sku: string | null };
export type OrderShip = { name: string; street: string; city: string; state: string; zip: string; country?: string };

/**
 * Dollars-and-cents as Apliiq's `price` string — "45.50", never 4550 and never 45.5.
 *
 * The formatting is moneyPlain's. What is local to Apliiq is the clamp: their API rejects a
 * negative price outright, and rounding here rather than at the boundary is how a payload ends up
 * a penny out from the order it was built from.
 */
export const priceString = (cents: number): string => moneyPlain(Math.max(0, Math.round(cents)));

/**
 * Apliiq's own "product skus" panel, pasted in as-is.
 *
 * That panel is the only place these values exist, and it renders them as a two-column block:
 *
 *     s     APQ-5902678S6A1
 *     m     APQ-5902678S7A1
 *     xxxl  APQ-5902678S21A1
 *
 * So the crew workflow is select, copy, paste — no retyping a SKU per size into six boxes, which
 * is six chances to transpose a digit into an order that ships the wrong garment. Tolerant of
 * tabs, commas, colons and multiple spaces because a copied table arrives however it arrives.
 * Anything that is not a size followed by a valid SKU is IGNORED rather than guessed at.
 */
export function parseSkuBlock(text: string): ApliiqVariant[] {
  const out: ApliiqVariant[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // No leading \b: Apliiq renders the label and the SKU as two table columns, and copying a table
    // sometimes glues them into "adjustableAPQ-5888216S87A1" with no separator at all. A word
    // boundary between "e" and "A" does not exist, so the anchored version silently found nothing
    // and the crew would read "No SKUs read" on a perfectly good paste.
    const m = line.match(/APQ-\d+S\d+A\d+\b/i);
    if (!m) continue;
    const sku = m[0].toUpperCase();
    const size = line.slice(0, m.index).replace(/[\t,:;|]+/g, " ").trim();
    if (!size) continue;                       // a bare SKU with no size tells us nothing
    // DEDUPE BY SKU, not by label. Keyed on the label, a cap sold in five colorways lost four of
    // them without a word: Apliiq labels every colorway of the five-panel cap "adjustable", and
    // each carries its own SKU. The second line pasted was silently discarded and the crew had no
    // way to see it. Two lines may share a label; they may not share a code.
    if (seen.has(sku)) continue;
    seen.add(sku);
    out.push({ size, sku });
  }
  return out;
}

/** The block above, rendered back out — so the field round-trips what the crew pasted. */
export function formatSkuBlock(variants: ApliiqVariant[] | null | undefined): string {
  return (Array.isArray(variants) ? variants : [])
    .filter((v) => v && typeof v.sku === "string" && SKU_RE.test(v.sku.trim()))
    .map((v) => `${v.size ?? ""}\t${(v.sku as string).trim().toUpperCase()}`)
    .join("\n");
}

export type BuiltOrder =  | { ok: true; payload: Record<string, unknown>; skus: string[] }
  | { ok: false; reason: string };

/**
 * Build the Create Order body, or say exactly why it cannot be built.
 *
 * REFUSES rather than sending a partial order. A line with no SKU is a garment Apliiq cannot
 * identify, and an order that silently drops it ships the customer half of what they paid for —
 * far worse than the crew queue, which a human reads.
 */
export function buildOrderPayload(order: { id: string; ship: OrderShip; items: OrderLine[] }): BuiltOrder {
  const items = (order.items ?? []).filter((i) => i && i.qty > 0);
  if (items.length === 0) return { ok: false, reason: "no line items" };

  const missing = items.filter((i) => !i.sku || !SKU_RE.test(i.sku));
  if (missing.length) {
    return { ok: false, reason: `no Apliiq SKU for: ${missing.map((m) => m.title).join(", ")}` };
  }

  const s = order.ship ?? ({} as OrderShip);
  const { first_name, last_name } = splitName(s.name);
  if (!last_name) return { ok: false, reason: "no shipping name" };
  for (const [k, v] of [["address1", s.street], ["city", s.city], ["zip", s.zip], ["province", s.state]] as const) {
    if (!String(v ?? "").trim()) return { ok: false, reason: `no shipping ${k}` };
  }

  // GT3 ships US-only today; the field is required and was absent entirely, so it is stated here
  // rather than left for Apliiq to assume. When a second country exists this reads it from `ship`.
  const country_code = (s.country ?? "US").trim().toUpperCase().slice(0, 2);
  const province_code = String(s.state ?? "").trim().toUpperCase().slice(0, 2);

  return {
    ok: true,
    skus: items.map((i) => i.sku as string),
    payload: {
      id: order.id,
      number: order.id.slice(0, 8),
      name: `GT3-${order.id.slice(0, 8)}`,
      order_number: order.id,
      line_items: items.map((i) => ({
        id: i.id,
        title: i.title,
        name: i.title,
        quantity: i.qty,
        price: priceString(i.priceCents),
        sku: (i.sku as string).toUpperCase(),
        grams: 0,
      })),
      shipping_address: {
        first_name, last_name,
        address1: s.street.trim(),
        city: s.city.trim(),
        province: s.state.trim(),
        province_code: country_code === "US" ? province_code : undefined,
        zip: s.zip.trim(),
        country: country_code === "US" ? "United States" : country_code,
        country_code,
      },
    },
  };
}
