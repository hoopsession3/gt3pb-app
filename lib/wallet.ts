// APPLE WALLET IS ONE SWITCH (2026-10-15, R7 of the customer re-audit). The member card drew "Add to Apple Wallet" from
// NEXT_PUBLIC_APPLE_WALLET alone, and /api/wallet/pass cannot sign a pass in this build — it answers 501 every time — so
// turning the flag on would have put a button on every member's card that always fails. The card asks this as well: it
// turns true in the change that makes the route sign passes, and the flag stays the deploy's own say on top of it.
export const APPLE_PASS_SIGNS = false;
