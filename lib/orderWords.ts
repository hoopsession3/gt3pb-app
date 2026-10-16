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

/** Where an order is, in four steps: in, being made, ready, picked up (Today's card and the ticket draw them). */
export const ORDER_STEPS = ["In", "Being made", "Ready", "Picked up"] as const;   // the tag's words, a step each (R7: "Making" beside "Being made")
export function stepOf(status: string): number {
  return status === "done" ? 3 : status === "ready" ? 2 : status === "preparing" ? 1 : 0;
}

/** What a cancel did, in a sentence (R3b — "Cancel reports its outcome"): canceled, and what becomes of the money; or why
 *  not — too late (with where the order is now), paid at the window (the crew cancels it there), or a failure. `said` is
 *  /api/orders/cancel's answer, null when there was none. */
export function cancelWords(said: { ok?: boolean; outcome?: string; now?: string; paid?: boolean } | null): { ok: boolean; text: string } {
  if (said?.ok === true) return { ok: true, text: said.paid ? "Canceled — your card is being refunded in full." : "Canceled — nothing was charged." };
  if (said?.outcome === "too_late") {
    const now = said.now && TAG[said.now] ? TAG[said.now].toLowerCase() : "";
    return { ok: false, text: now === "canceled" ? "That order is already canceled." : `Too late to cancel${now ? ` — it's ${now === "picked up" ? "been picked up" : now}` : ""}. Ask at the window.` };
  }
  if (said?.outcome === "at_window") return { ok: false, text: "Paid at the window — the crew cancels it there." };
  return { ok: false, text: "Couldn't cancel it just now — try again, or ask at the window." };
}
