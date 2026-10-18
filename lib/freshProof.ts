// PROVED JUST NOW (R27, 2026-10-18 — the 10/10 audit, security F7; Ryan: "Yes, a fresh code").
//
// Deleting an account asked for nothing but a session: a phone left unlocked on a table, or lent for a minute, could
// delete its owner's account for good. Now the delete asks for proof that it is them, given just now — the 8-digit code
// emailed when they press Delete (Supabase's own email code, the one the sign-in screen asks for), or, for an account
// that signs in with Apple, Apple's sheet on the iPhone (Face ID).
//
// Supabase writes each proof into the session's access token — `amr`: the method, and when, in seconds — and keeps those
// times through every renewal: a session renewed an hour later still says when its person last proved it. So "just now"
// is read from the token, by the server only after the auth service has checked that same token (lib/apiAuth), never
// instead of it; the app reads it too, only to know whether to ask for a code at all (components/DeleteAccount).
//
// One known gap, said: an access-token hook may write `amr` as bare method names, with no times (RFC 8176's form). This
// project has none (no migration makes one). If one is added, nothing here says "proved" again until it writes the times.

/** How recent a proof the delete takes: five minutes — the code is checked and the delete sent in the same tap. */
export const PROVED_FOR_S = 5 * 60;

/** A clock a little ahead of ours is the auth service's, not a forgery: a minute of it is allowed. */
const DRIFT_S = 60;

/** The token's claims, read — not checked. Only ever for a token the auth service has already checked. */
export function claimsOf(jwt: unknown): Record<string, unknown> | null {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1] || parts[1].length > 8192) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const v: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** When the session's person last proved it is them (unix seconds): the latest entry in the token's `amr` — a code, a
 *  link, a password, Apple, an authenticator — never an anonymous session's. Null when it names none. */
export function provedAt(claims: Record<string, unknown> | null): number | null {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return null;
  let at: number | null = null;
  for (const e of amr) {
    if (!e || typeof e !== "object") continue;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !method || method === "anonymous") continue;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (at === null || timestamp > at) at = timestamp;
  }
  return at;
}

/** Proved in the last `windowS` seconds before `nowMs` — and not later than a minute past it (a time from the future is
 *  no proof). */
export function provedWithin(claims: Record<string, unknown> | null, nowMs: number = Date.now(), windowS: number = PROVED_FOR_S): boolean {
  const at = provedAt(claims);
  if (at === null) return false;
  const now = nowMs / 1000;
  return at >= now - windowS && at <= now + DRIFT_S;
}
