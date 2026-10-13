// ONE ORDER, ONE SET OF WORDS (2026-10-13, R3b of the customer audit — "one status vocabulary", board 09, approved).
//
// The same cup order was "Order received" in the bar, "In" on Today, "We're making your order now" in a push, "Your
// order is being made ☕" in a toast — and ready "at the bar" in one place and "at the window" in the next. These are its
// words wherever its customer reads them: the bar, Today, the toast, the ready email and the push. The push function
// keeps a copy (supabase/functions/push/policy.ts — Deno cannot import this), and scripts/smoke.cjs holds the two to
// the same words. The crew's own words — New, In progress, Ready · hand off — are the Pass's (lib/orderStatus).
//
// Pure, and small: the bar on every page imports it (lib/activeOrder's rule).

const TAG: Record<string, string> = { preparing: "Being made", ready: "Ready", done: "Picked up", void: "Canceled" };
const LINE: Record<string, string> = {
  new: "We have it. Ready in about 8 minutes.",
  preparing: "Being made now.",
  ready: "Ready — grab it at the window.",
  done: "Picked up. Enjoy.",
  void: "Canceled.",
};

/** The order's status as a tag: In · Placed ahead · Being made · Ready · Picked up · Canceled.
 *  `ahead`: placed ahead of a stop whose window hasn't opened (0343). */
export function orderTag(status: string, ahead = false): string {
  if (status === "new") return ahead ? "Placed ahead" : "In";
  return TAG[status] ?? "Your order";
}

/** Where it is, in one sentence. `aheadLine`: a pre-order's own ("Made when we open — today at 7:00am", lib/ordering
 *  readyWords), which says when instead of "about 8 minutes". */
export function orderLine(status: string, aheadLine?: string | null): string {
  if (status === "new" && aheadLine) return aheadLine;
  return LINE[status] ?? "";
}
