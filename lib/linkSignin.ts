// A SIGN-IN THIS DEVICE NEVER ASKED FOR, SAID (R9, 2026-10-16 — the abuse audit's eighth).
//
// A sign-in link carries its session in the address (lib/supabase: the implicit flow, kept on purpose — a link asked
// for on a laptop still signs in on the phone that opens it). So does a link someone else asked for, for their own
// account: opened here, it signed this device into theirs, quietly — and what was typed next (a phone, an address, an
// order) went to them. The way PKCE closes that also closes the laptop-to-phone link. Instead, a device remembers when
// it asked for a sign-in; a session that arrives in an address this device did not ask for in the last hour is shown
// with its email — "Signed in as …" — and one tap signs it out (components/AuthProvider, LinkSigninNotice).
//
// Client-only and best-effort: storage that is refused reads as "not asked", which shows the notice — the safe side.
const KEY = "gt3-signin-asked";
// An hour, and one sign-in (R24 — the 10/10 audit, API F23): a day was the window in which a link someone else asked
// for, opened here, signed this device into their account with no notice. An emailed link lasts an hour (Supabase's
// own expiry); the ask is used up by the first sign-in that comes of it — the link's or the code's — so a second link
// in that hour is said too.
export const ASKED_FOR_MS = 60 * 60 * 1000;

/** This device asked for a sign-in email (a code and a link). */
export function markSigninAsked(now: number = Date.now()): void {
  try { localStorage.setItem(KEY, String(now)); } catch { /* storage refused: the notice shows, which is safe */ }
}

/** Did this device ask for one in the last hour? */
export function signinAskedHere(now: number = Date.now()): boolean {
  try {
    const t = Number(localStorage.getItem(KEY));
    return Number.isFinite(t) && t > 0 && now - t >= 0 && now - t < ASKED_FOR_MS;
  } catch { return false; }
}

/** Did this device ask for one in the last hour — and the ask used up, by the sign-in that came of it (R24)? */
export function takeSigninAsked(now: number = Date.now()): boolean {
  const asked = signinAskedHere(now);
  try { localStorage.removeItem(KEY); } catch { /* storage refused: it read as not asked anyway */ }
  return asked;
}

/** Does this address carry a sign-in's session (not a password reset's, which has its own screen)? Pure. */
export function carriesSession(hash: string): boolean {
  return /(?:^#|&)access_token=/.test(hash) && !/(?:^#|&)type=recovery(?:&|$)/.test(hash);
}

/** The page opened at an address carrying a sign-in's session — read when this module loads, which lib/supabase makes
 *  happen before the auth client reads that address and takes the session out of it. */
export const OPENED_WITH_SESSION = typeof window !== "undefined" && carriesSession(window.location?.hash ?? "");

// A SESSION IN THE QUERY STRING IS NOT OURS (R24 — the 10/10 audit, security F8, the web half). R18 made the iPhone app's
// sign-in links (components/AuthProvider signInWithUrl) read a session from the fragment only. The web's own reading —
// the auth client's, as the page opens — still took one from the query string too, and before the fragment: Supabase's
// helper merges the two, the query winning. Supabase never puts a session there; a link that does is one someone else
// made, and it signed this browser into their account with no notice (the notice above reads the fragment). The client
// now takes a session from an address only when the fragment carries it and the query carries nothing of the kind
// (lib/supabase detectSessionInUrl), and a session's tokens found in the query are taken out of the address as the page
// opens — kept out of the history, the bookmarks and whatever the address is copied into next.
const QUERY_TOKENS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token", "expires_in", "expires_at", "token_type"];
const AUTH_ANSWERS = [...QUERY_TOKENS, "error", "error_code", "error_description"];

/** Should the auth client take this address as a sign-in's answer? Only when the fragment carries one (a session, or a
 *  failed link's error) and the query string carries nothing of the kind. Pure. */
export function answerInFragmentOnly(url: URL): boolean {
  if (AUTH_ANSWERS.some((k) => url.searchParams.has(k))) return false;
  const h = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  return Boolean(h.get("access_token") || h.get("error") || h.get("error_code") || h.get("error_description"));
}

/** The same address with a session's tokens taken out of its query string — null when it carries none. Pure. */
export function withoutQueryTokens(href: string): string | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (!QUERY_TOKENS.some((k) => url.searchParams.has(k))) return null;
  for (const k of QUERY_TOKENS) url.searchParams.delete(k);
  return url.toString();
}

if (typeof window !== "undefined") {
  try {
    const clean = withoutQueryTokens(window.location.href);
    if (clean) window.history.replaceState(window.history.state, "", clean);
  } catch { /* an address that can't be rewritten: the client still refuses what is in it */ }
}
