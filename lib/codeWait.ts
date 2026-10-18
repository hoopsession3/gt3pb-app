// "NOT NOW" TO THE TWO-STEP CODE (R28, 2026-10-18 — the 10/10 audit, security F6; 0433).
//
// An owner or admin who said "Not now" to this sign-in's two-step code is crew to the database until they give it: every
// owner's and admin's door answers no, and every read of theirs comes back empty. So every screen draws them as an event
// manager — the most a crew member's sections hold (components/AuthProvider) — and Money's "nothing needs attention" or
// an empty customer list is never drawn as an all-clear. Nothing is written: the profile as stored is the provider's.
//
// Its own small module, and lib/roles not imported: this rides in every route's first download with the provider, and
// lib/roles at run time there split the shared bundle into one more chunk on every route (+0.96 KB gzipped, measured).
// leaderAsStored is lib/roles roleOf's reading of an owner or admin — r28.test holds the two to the same answer for every
// role, with and without the legacy flag.

type Stored = { role?: string | null; is_admin?: boolean };

/** The role as stored is an owner's or an admin's — or, from before roles, the legacy flag with no role (roleOf: owner). */
export function leaderAsStored(p: Stored | null): boolean {
  const r = p?.role ?? null;
  return r === "owner" || r === "admin" || (r === null && !!p?.is_admin);
}

/** While the code waits, an owner or admin as an event manager; anyone else, or no wait, the very same profile. */
export function drawnWhileCodeWaits<P extends Stored>(p: P | null, waiting: boolean): P | null {
  return waiting && p && leaderAsStored(p) ? { ...p, role: "event_manager", is_admin: false } : p;
}
