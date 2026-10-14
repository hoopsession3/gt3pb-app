// WHAT A CUSTOMER CAN TURN OFF (2026-10-14, R6 of the customer audit — decided by Ryan: every kind but receipts).
//
// The audit found one switch: the truck-live ping on Find Us. Order alerts could be stopped only in the phone's own
// Settings, the emails not at all, and the privacy page said each kind could be turned off where it was turned on. Now the
// account's Notifications screen (components/NotificationsSheet) has a switch per kind:
//   order updates      the order being made and ready (push, and the "ready" email), a delivery on the porch (email, text)
//   pickup reminders   the evening before a pack's pickup (push, email, text — 0399's pickup_tomorrow)
//   truck live         the go-live ping — this device's own (push_subscriptions.wants_live, 0257), as on Find Us
//   texts              the yes to texts (0398), for the number on their orders
// Never switched off: receipts and confirmations, and any change to an order already placed — a pack moved or canceled,
// a stop called off, a refund. Those are the order itself, not news about it.
//
// The two that belong to the account are kept where the crew's are, in the person's own notif_prefs row (0177, own-row
// RLS): their keys in muted_categories, beside the crew's categories (order, money, brew…), which never share a name.
// lib/notify customerMuted reads them for the server's sends; supabase/functions/push/policy.ts CUSTOMER_MUTE names the
// same two for the push function (scripts/smoke.cjs holds them together).

export const CUSTOMER_KINDS = [
  { key: "order_updates", title: "Order updates", sub: "When your order is being made, is ready, or is on your porch" },
  { key: "pickup_reminders", title: "Pickup reminders", sub: "The evening before you pick up a pack" },
] as const;

export type CustomerKind = (typeof CUSTOMER_KINDS)[number]["key"];

export const CUSTOMER_KIND_KEYS: readonly CustomerKind[] = CUSTOMER_KINDS.map((k) => k.key);

/** Is this kind turned off, by the muted list notif_prefs keeps? */
export const kindMuted = (muted: readonly string[] | null | undefined, kind: CustomerKind): boolean => !!muted?.includes(kind);

/** The muted list with one kind turned on or off — every other entry (the crew's categories among them) kept as it was. */
export function withKind(muted: readonly string[] | null | undefined, kind: CustomerKind, on: boolean): string[] {
  const rest = (muted ?? []).filter((k) => k !== kind);
  return on ? rest : [...rest, kind];
}

/** What always comes, said under the switches. */
export const ALWAYS_SENT = "Receipts, and any change to an order you’ve paid for — moved, canceled or refunded — always come by email.";
