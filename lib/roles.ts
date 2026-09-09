// THE ROLE VOCABULARY — matches profiles.role (migration 0031).
//
// This block lived inside components/AuthProvider.tsx, which is a React module. That was fine until
// something that is NOT React needed it: lib/access.ts decides who may see a staff surface and is
// deliberately pure so it can be unit-tested without a renderer. Rather than copy four constants
// into it — the exact move that left "leadership" typed seven ways with drift, per the note below —
// the vocabulary moved here and AuthProvider re-exports every name it used to own, so no existing
// import had to change.

export type Role = "member" | "server" | "contractor" | "operator" | "event_manager" | "admin" | "owner";
export const ALL_ROLES: Role[] = ["member", "server", "contractor", "operator", "event_manager", "admin", "owner"];
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
