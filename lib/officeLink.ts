import { SQUARE_BASE, squareDeadline, squareHeaders } from "./squareServer";

// AN OFFICE PAYMENT LINK, SWITCHED OFF (R9, 2026-10-16 — 0417). A canceled office order's link stayed live at Square: the
// client paid it, the webhook marked the canceled order paid, and nothing said a refund was owed. A link is switched off
// by deleting it at Square — by its own id, kept on the order since 0417 (business_orders.paylink_id); a link made before
// that is found by the Square order it carries (the one the webhook matches on), among the account's links.
//
//   off      Square has no such link now (deleted here, or gone already) — nothing can be paid through it.
//   none     no link was ever made for it.
//   unknown  Square did not say — the link may still take money (the caller says so to the crew; the webhook flags a
//            payment that lands on a canceled order anyway).
export type LinkOff = "off" | "none" | "unknown";

const PAGES = 5;   // up to 500 links searched for one made before its id was kept

export async function switchOffPaylink(token: string, link: { paylink_id?: string | null; square_order_id?: string | null; paylink_url?: string | null }): Promise<LinkOff> {
  let id: string | null = link.paylink_id ?? null;
  if (!id) {
    if (!link.paylink_url && !link.square_order_id) return "none";
    if (!link.square_order_id) return "unknown";
    const found = await findLink(token, link.square_order_id);
    if (found === undefined) return "unknown";
    if (found === null) return link.paylink_url ? "unknown" : "none";
    id = found;
  }
  try {
    const r = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links/${encodeURIComponent(id)}`, { method: "DELETE", headers: squareHeaders(token), signal: squareDeadline() });
    if (r.ok || r.status === 404) return "off";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** The link carrying this Square order: its id, null when none does, undefined when Square could not be asked. */
async function findLink(token: string, squareOrderId: string): Promise<string | null | undefined> {
  let cursor: string | null = null;
  try {
    for (let page = 0; page < PAGES; page++) {
      const q = new URLSearchParams({ limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links?${q}`, { headers: squareHeaders(token), signal: squareDeadline() });
      if (!r.ok) return undefined;
      const j = (await r.json().catch(() => null)) as { payment_links?: { id?: string; order_id?: string }[]; cursor?: string } | null;
      const hit = (j?.payment_links ?? []).find((l) => l.order_id === squareOrderId);
      if (hit?.id) return hit.id;
      cursor = j?.cursor ?? null;
      if (!cursor) return null;
    }
    return undefined;   // more links than were searched: unknown, never "none"
  } catch {
    return undefined;
  }
}
