// WHAT WE SAY TO A CUSTOMER ABOUT THEIR ORDER — one home for every message, so a receipt sent by
// hand two days later is word-for-word the receipt the checkout sent.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// Ryan's first cap order was charged, printed and never emailed. The fix for that is a way to send
// it again — and the obvious way to build one is to write the message a second time, in the resend
// route. That is how this repo ended up with thirty money formatters, two markdown renderers, four
// benefit describers and three idempotency keys. A resent receipt that does not match the original
// is worse than no resend at all: the customer now has two different accounts of what they bought.
//
// So the text lives here, once, and both the checkout and the resend read it.
//
// ── PLAIN TEXT, DELIBERATELY ───────────────────────────────────────────────────────────────────
// lib/notify sends text, not HTML. A receipt that renders as a blank page in a mail client the
// sender never tested is a support ticket; a plain one is readable everywhere and forwards cleanly
// into a dispute, which is the moment it matters most.

import { money } from "./money";

export type ReceiptLine = { title: string; qty: number; unit_cents?: number | null };

export type ReceiptOrder = {
  id: string;
  ship_name?: string | null;
  total_cents?: number | null;
  items: ReceiptLine[];
  tracking_number?: string | null;
  tracking_url?: string | null;
};

/** The short reference a customer quotes back. The order id is a UUID; nobody reads one aloud. */
export function orderRef(id: string): string {
  return String(id ?? "").replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** "Ryan" from "Ryan Thompkins". Empty when there is no name — never the string "undefined". */
export function firstName(full: string | null | undefined): string {
  return String(full ?? "").trim().split(/\s+/)[0] || "";
}

/** "1× GT3 6-Panel Cap, 2× Tee" — the line a person checks against what arrives in the box. */
export function itemLine(items: readonly ReceiptLine[]): string {
  return (items ?? [])
    .filter((l) => l && l.title)
    .map((l) => `${Math.max(1, Number(l.qty) || 1)}× ${l.title}`)
    .join(", ");
}

// ── THE MERCH RECEIPT ON THE SCREEN (2026-10-13, R5 — "A merch receipt") ──────────────────────────────────────────────
// The done screen said "Thanks — you'll get an email" and nothing about the order: no number, no lines, no total, no
// address — and when the email didn't go out, nothing at all. It reads the checkout's answer now: the lines the route
// priced and the total it charged, never the phone's own cart, with the same number the email gives (orderRef).

export type ShopReceiptLine = { title: string; variant: string | null; qty: number; unit_cents: number };
export type ShopReceipt = { no: string; lines: ShopReceiptLine[]; total_cents: number; ship_to: string; email: string | null };

/** What the merch done screen shows: "#A1B2C3", the lines as charged, the total, "Jordan Reyes · Simpsonville, SC", and
 *  the address the receipt went to (null when no email went out — the screen says so instead). */
export function shopReceipt(o: { id: string; ship_name?: string | null; city?: string | null; state?: string | null; total_cents: number; lines: readonly ShopReceiptLine[]; emailed_to?: string | null }): ShopReceipt {
  const place = [String(o.city ?? "").trim(), String(o.state ?? "").trim()].filter(Boolean).join(", ");
  return {
    no: `#${orderRef(o.id)}`,
    lines: (o.lines ?? []).filter((l) => l && l.title).map((l) => ({ title: l.title, variant: l.variant || null, qty: Math.max(1, Math.floor(Number(l.qty) || 1)), unit_cents: Math.max(0, Math.round(Number(l.unit_cents) || 0)) })),
    total_cents: Math.max(0, Math.round(Number(o.total_cents) || 0)),
    ship_to: [String(o.ship_name ?? "").trim(), place].filter(Boolean).join(" · "),
    email: o.emailed_to ? String(o.emailed_to) : null,
  };
}

/**
 * The order receipt. `resent` is true when a person pressed the button rather than the checkout
 * sending it — the customer is told so plainly, because a second copy of a receipt arriving days
 * later with no explanation reads like a second charge.
 */
export function orderReceipt(o: ReceiptOrder, resent = false): { subject: string; message: string } {
  const who = firstName(o.ship_name);
  const ref = orderRef(o.id);
  const lines = itemLine(o.items);
  const total = money(o.total_cents ?? null);
  return {
    subject: resent ? `Your GT3 order — receipt (#${ref})` : "Your GT3 order is in",
    message: [
      resent
        ? `${who ? `${who}, here` : "Here"}'s the receipt for your order — sending it again because the first one didn't reach you. This is not a new charge.`
        : `Thanks${who ? ` ${who}` : ""}! We got your order.`,
      "",
      lines || "(no items on this order)",
      `Total ${total}`,
      `Order #${ref}`,
      "",
      o.tracking_number
        ? `On its way. Tracking: ${o.tracking_number}${o.tracking_url ? `\n${o.tracking_url}` : ""}`
        : "We'll email tracking the moment it ships.",
    ].join("\n"),
  };
}

/**
 * The shipped notice. Same home as the receipt on purpose — it was written inline in the Apliiq
 * webhook, which is the only reason the two messages never had to agree about anything.
 */
export function shippedNotice(o: ReceiptOrder): { subject: string; message: string } {
  const ref = orderRef(o.id);
  return {
    subject: "Your GT3 order shipped",
    message: [
      `Good news — your order is on the way.`,
      itemLine(o.items) || "",
      o.tracking_number ? `Tracking: ${o.tracking_number}` : "",
      o.tracking_url || "",
      `Order #${ref}`,
    ].filter(Boolean).join("\n"),
  };
}
