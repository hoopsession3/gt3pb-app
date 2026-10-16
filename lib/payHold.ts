// A CARD PAYMENT WHOSE ANSWER NEVER CAME HOLDS THE CART STILL (2026-10-15, R7 of the customer re-audit).
//
// The cup checkout keeps its key beside the cart (components/useIdemKey, durable), so a retry after a lost answer is the
// same payment and is answered from the first one (lib/chargeOnce). A change to the cart or the tip while that answer was
// still unknown was a new checkout — a new key — and, when the first payment had gone through, a second charge. So the
// key's record says when its last answer never came ("open"), and while it does, the cart and the tip hold still: Pay
// asks about the first payment, and nothing else is sold under a new key. The key is forgotten after two hours, as before.
// Here, not in components/useIdemKey, because the cart (components/AppProvider) asks on every screen and the hook loads
// with the checkout sheet.

/** How long a durable checkout key is kept: a lost answer is retried in minutes; the same cart much later is a new order. */
export const DURABLE_KEY_MS = 2 * 60 * 60 * 1000;

/** Where the cup checkout keeps its key (components/Checkout). */
export const CUP_PAY_KEY = "gt3-co-idem";

/** Whether the durable key at `persist` is waiting on an answer that never came, and is not yet forgotten. */
export function payHeldOpen(persist: string = CUP_PAY_KEY): boolean {
  try {
    const r = JSON.parse(window.localStorage.getItem(persist) ?? "null") as { open?: unknown; at?: unknown } | null;
    return !!r && r.open === true && typeof r.at === "number" && Date.now() - r.at < DURABLE_KEY_MS;
  } catch {
    return false;   // a blocked store holds nothing — and the checkout's own key holder still holds Pay to the same key
  }
}
