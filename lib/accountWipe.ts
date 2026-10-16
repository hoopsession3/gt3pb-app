// WHAT A SIGNED-OUT PHONE KEEPS (R10b, 2026-10-16 — the 10/10 audit).
//
// Signing out cleared the session and nothing else: on the truck's shared phone the next person found the last board's
// customer names and tickets (gt3-kds-snap), the last member's orders (gt3-order-snap-…), the crew's unsent notes and
// audit drafts, the addresses typed into the map (gt3geo:…), and a payment's reference. These are the person's, and go
// with them. What stays is the phone's own: its look, its last section, a guest's tickets (no account owns them), and
// the offline queue — whose writes are stamped with who made them and replayed only for that person (components/offline).
export const ACCOUNT_KEYS = ["gt3-kds-snap", "gt3-recents", "gt3-paid-ref", "gt3-co-idem"] as const;
export const ACCOUNT_PREFIXES = ["gt3-order-snap-", "gt3-audit-draft", "gt3geo:", "gt3-address:"] as const;

/** The keys of a store that are the signed-out person's. Pure. */
export function accountKeysIn(keys: readonly string[]): string[] {
  return keys.filter((k) => (ACCOUNT_KEYS as readonly string[]).includes(k) || ACCOUNT_PREFIXES.some((p) => k.startsWith(p)));
}

/** Take them off this device. Never throws: storage that refuses is left as it is. */
export function wipeAccountData(): void {
  try {
    if (typeof window === "undefined") return;
    for (const k of accountKeysIn(Object.keys(window.localStorage))) window.localStorage.removeItem(k);
    for (const k of accountKeysIn(Object.keys(window.sessionStorage))) window.sessionStorage.removeItem(k);
  } catch { /* storage refused: nothing more to do */ }
}
