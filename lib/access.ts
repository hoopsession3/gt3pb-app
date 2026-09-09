// WHO MAY SEE A STAFF SURFACE — the one place that decides, and the one place that knows the
// difference between "no" and "we do not know yet".
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// AuthProvider's `profile` was null in three unrelated situations: not fetched yet, the fetch
// failed, and this person genuinely has no profile row. roleOf(null) returns "member". So every
// staff gate in the app read all three as "you are a customer", and app/crew renders
//
//     "Staff only. This area is for GT3PB staff. If that's you, ask the owner to add you"
//
// on exactly that condition. A slow or failed profile read told the OWNER he did not work here and
// shut him out of the entire crew console, with a button inviting him to ask himself for access.
// Seen live in production on 2026-09-09, mid-navigation.
//
// It is the same bug class as every false-empty state scripts/falseempty.audit.mjs exists for — a
// failed read rendered as a confident negative — sitting in the auth layer, where the negative is
// "you are not staff". That is why it gets a module rather than four inline conditions: the four
// gates (crew, scan, academy, driver) were each about to spell this policy out for themselves, and
// four copies of an access rule is how one of them ends up subtly different.
//
// ── THE RULE ───────────────────────────────────────────────────────────────────────────────────
// An unknown profile is never a denial. It is a WAIT, or — when the read actually failed — a
// FAILURE the person can see and retry. Denial is reserved for the one case we can stand behind:
// we asked, we got an answer, and the answer does not carry a staff role.
import { roleOf, STAFF_ROLES, LEADERSHIP_ROLES, type Role } from "./roles";

/** Mirrors AuthProvider's ProfileStatus without importing the provider (this file stays pure). */
export type ProfileStatus = "loading" | "ready" | "error";

export type Access =
  | "anon"    // nobody is signed in — offer sign-in, not a refusal
  | "wait"    // signed in, profile not known yet — say nothing about their role
  | "failed"  // the profile read failed — say THAT, and offer a retry
  | "allow"
  | "deny";   // asked, answered, and the answer is not staff

export type ProfileLike = { role?: string | null; is_admin?: boolean } | null;

/**
 * @param signedIn  is there a session at all
 * @param status    what we know about the profile
 * @param profile   the profile itself, meaningful only when status === "ready"
 * @param allowed   which roles this surface admits; defaults to every staff role
 */
export function staffAccess(
  signedIn: boolean,
  status: ProfileStatus,
  profile: ProfileLike,
  allowed: readonly string[] = STAFF_ROLES,
): Access {
  if (!signedIn) return "anon";
  if (status === "error") return "failed";
  if (status === "loading") return "wait";
  return allowed.includes(roleOf(profile) as Role) ? "allow" : "deny";
}

/** The leadership variant, so callers do not have to remember which constant to pass. */
export const leadershipAccess = (signedIn: boolean, status: ProfileStatus, profile: ProfileLike): Access =>
  staffAccess(signedIn, status, profile, LEADERSHIP_ROLES);

/** True only for "allow". Every other verdict means something a UI should say out loud. */
export const isAllowed = (a: Access): boolean => a === "allow";
