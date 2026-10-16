// A SIGN-IN THIS DEVICE NEVER ASKED FOR, SAID (R9, 2026-10-16 — the abuse audit's eighth).
//
// A sign-in link carries its session in the address (lib/supabase: the implicit flow, kept on purpose — a link asked
// for on a laptop still signs in on the phone that opens it). So does a link someone else asked for, for their own
// account: opened here, it signed this device into theirs, quietly — and what was typed next (a phone, an address, an
// order) went to them. The way PKCE closes that also closes the laptop-to-phone link. Instead, a device remembers when
// it asked for a sign-in; a session that arrives in an address this device did not ask for in the last day is shown
// with its email — "Signed in as …" — and one tap signs it out (components/AuthProvider, LinkSigninNotice).
//
// Client-only and best-effort: storage that is refused reads as "not asked", which shows the notice — the safe side.
const KEY = "gt3-signin-asked";
export const ASKED_FOR_MS = 24 * 60 * 60 * 1000;

/** This device asked for a sign-in email (a code and a link). */
export function markSigninAsked(now: number = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)); } catch { /* storage refused: the notice shows, which is safe */ }
}

/** Did this device ask for one in the last day? */
export function signinAskedHere(now: number = Date.now()): boolean {
  try {
    const t = Number(localStorage.getItem(KEY));
    return Number.isFinite(t) && t > 0 && now - t >= 0 && now - t < ASKED_FOR_MS;
  } catch { return false; }
}

/** Does this address carry a sign-in's session (not a password reset's, which has its own screen)? Pure. */
export function carriesSession(hash: string): boolean {
  return /(?:^#|&)access_token=/.test(hash) && !/(?:^#|&)type=recovery(?:&|$)/.test(hash);
}

/** The page opened at an address carrying a sign-in's session — read when this module loads, which lib/supabase makes
 *  happen before the auth client reads that address and takes the session out of it. */
export const OPENED_WITH_SESSION = typeof window !== "undefined" && carriesSession(window.location?.hash ?? "");
