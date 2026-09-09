// THE ROLE VOCABULARY — matches profiles.role (migration 0031).
//
// This block lived inside components/AuthProvider.tsx, which is a React module. That was fine until
// something that is NOT React needed it: lib/access.ts decides who may see a staff surface and is
// deliberately pure so it can be unit-tested without a renderer. Rather than copy four constants
// into it — the exact move that left "leadership" typed seven ways with drift, per the note below —
// the vocabulary moved here and AuthProvider re-exports every name it used to own, so no existing
// import had to change.

export type Role = "member" | "server" | "contractor" | "operator" | "event_manager" | "admin" | "owner";

/** Most senior first. This is the ONE ordering in the app — every roster sort, every role
 *  dropdown and every tier grouping reads it, and ALL_ROLES is this list reversed rather than a
 *  second hand-written copy free to disagree about where `operator` sits relative to
 *  `contractor`. (It did: the team console's ROLE_ORDER and ALL_ROLES had them swapped, which
 *  was harmless only because nothing rendered ALL_ROLES in order.) */
export const SENIORITY: Role[] = ["owner", "admin", "event_manager", "operator", "contractor", "server", "member"];
export const ALL_ROLES: Role[] = [...SENIORITY].reverse();
// Tier lists, defined ONCE (the audit found "leadership" typed seven ways with drift — one list
// dropped event_manager, one included a role that doesn't exist).
export const LEADERSHIP_ROLES: Role[] = ["event_manager", "admin", "owner"];
export const STAFF_ROLES: Role[] = ["server", "contractor", "operator", "event_manager", "admin", "owner"];

// Effective role with a graceful fallback for profiles loaded before the roles
// migration ran (legacy admins read as owner).
//
// NOTE, and it is the whole reason lib/access.ts exists: roleOf(null) is "member". That is correct
// as a DEFAULT and wrong as an ANSWER — a profile that has not loaded is not a customer. Never gate
// on this alone; gate on lib/access.ts, which knows whether the profile is known yet.
export function roleOf(p: { role?: string | null; is_admin?: boolean } | null): Role {
  const r = p?.role as Role | null | undefined;
  if (r && ALL_ROLES.includes(r)) return r;
  return p?.is_admin ? "owner" : "member";
}

export const isLeadership = (p: { role?: string | null; is_admin?: boolean } | null) => LEADERSHIP_ROLES.includes(roleOf(p) as Role);
export const isStaff = (p: { role?: string | null; is_admin?: boolean } | null) => STAFF_ROLES.includes(roleOf(p) as Role);

/** A raw profiles.role string narrowed to the vocabulary, with NO is_admin fallback. Use this
 *  where you want the role as stored — a roster row, a dropdown value. Use roleOf() where you
 *  want the role as it should be ENFORCED, which is a different question. */
export const toRole = (v: unknown): Role => (ALL_ROLES.includes(v as Role) ? (v as Role) : "member");

// ── WHAT A ROLE IS CALLED ────────────────────────────────────────────────────────────────────────
// Four modules used to name these seven roles independently: the team console (ROLE_META), the org
// chart (ROLE_LABEL), the invite form (ROLES) and the offer letter (ROLE_ACCESS.label). Two of them
// had already drifted — "Event Manager" in three places, "Event manager" in two — which is the
// harmless-looking half of the failure. The harmful half is that adding a role to the CHECK
// constraint means finding four maps, and missing one renders a blank cell rather than a label.
//
// So the NAME lives here, once. Modules keep their own FACTS about a role — what an offer letter
// says it reaches, what the invite form's one-line hint explains, what a curriculum calls its
// audience — because those are genuinely local. They just do not get to restate the name.
// scripts/dupe.audit.mjs fails the build if a fifth map appears.
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  event_manager: "Event Manager",
  operator: "Operator",
  contractor: "Contractor",
  server: "Server",
  member: "Member",
};

/** Safe for any value off the wire — an unrecognised role reads as "Member", the same default
 *  roleOf() applies, so a screen never renders an empty cell where a role should be. */
export const roleLabel = (v: unknown): string => ROLE_LABEL[toRole(v)];

// ── TIERS, DERIVED ───────────────────────────────────────────────────────────────────────────────
// The team console grouped people into lead / crew / member with a hand-written `tier` on each of
// its seven role entries. That partition is ALREADY decided by LEADERSHIP_ROLES and STAFF_ROLES
// above — the two agreed when checked, which is exactly the kind of agreement that stops being true
// the day somebody promotes a role in one list. Derived, they cannot disagree.
export type Tier = "lead" | "crew" | "member";
export const tierOf = (v: unknown): Tier => {
  const r = toRole(v);
  return LEADERSHIP_ROLES.includes(r) ? "lead" : STAFF_ROLES.includes(r) ? "crew" : "member";
};

// ── WHAT THIS FILE IS DELIBERATELY NOT ───────────────────────────────────────────────────────────
// lib/academy.ts has its own Role type — "founder" | "admin" | "event_manager" | "operator" |
// "staff" | "contractor" — and it is NOT a drifted copy of this one. It is a curriculum audience:
// owner and admin study the same founder track, server and operator study the same operator track.
// app/academy/page.tsx holds the mapping between the two, which is the right place for it. Merging
// them would force the curriculum to grow a track every time the database grows a role, and would
// give one word two masters. Named here so the next sweep does not "finish the job".
