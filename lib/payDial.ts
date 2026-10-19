// THE OWNER'S PAY-AT-PICKUP SWITCH, UNREAD (R39 — the fresh audit's API11-06). live_status.pay_at_pickup (0147) is read by
// the two doors that take an order to be paid at the truck: /api/checkout (cups) and /api/reserve (packs). Each took a
// read that failed as the switch on — a database blip let pickup orders through with the owner's switch off. A read that
// failed is no answer: the door waits, and says nothing was charged. Server-only.
export const PAY_DIAL_UNREAD = "We couldn't check whether pay at pickup is on just now — try again in a moment, or pay by card. Nothing was charged.";
