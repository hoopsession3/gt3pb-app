import { supabaseAdmin } from "./supabaseAdmin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authUnavailable } from "./authAnswer";

// Verify the caller's Supabase access token (sent as Authorization: Bearer <jwt>)
// and return their user id and verified email. Server-only. Returns null if missing/invalid.
//
// The email is here so a route that needs it (app/api/office seeds a standing account's contact
// from it) reads it from the SAME verified session as the id, never from the client body — and
// never by re-implementing this token check inline. This is the one place a route reads a session;
// scripts/api.audit.mjs does not accept an inline `.auth.getUser(` as a guard.
export async function userFromRequest(req: Request): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

// THE CALLER OF A CARD DOOR (R15, 2026-10-17 — the 10/10 audit, API F13). userFromRequest answers null for no session AND
// for an auth service that did not answer, and the card doors read null as a guest: during an auth blip a member paid
// the list price (the perks went, the total no longer matched — "the price changed"), their order landed on no account,
// and a member-only door said "sign in" to someone signed in. A door that charges asks this instead: a person, a guest
// (no bearer, or one the auth service refused), or UNAVAILABLE — a bearer was sent and the service could not say whose
// it is — which the door answers 503, nothing charged, before anything else.
export type Caller = { kind: "user"; id: string; email: string | null } | { kind: "guest" } | { kind: "unavailable" };
export const SIGN_IN_UNCHECKED = "We couldn't check your sign-in just now — nothing was charged. Try again in a moment.";

export async function callerFromRequest(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { kind: "guest" };
  if (!supabaseAdmin) return { kind: "unavailable" };
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (data?.user) return { kind: "user", id: data.user.id, email: data.user.email ?? null };
    return authUnavailable(error) ? { kind: "unavailable" } : { kind: "guest" };
  } catch {
    return { kind: "unavailable" };
  }
}

// Staff-only gate for internal READ routes (assets, inventory) so they never return
// business data to a guest/member JWT. Uses the caller's token with the anon client +
// is_staff() (SECURITY DEFINER, keys off auth.uid()) — works without the service-role
// key, so it only needs the always-present anon key. Fails closed.
export async function staffFromRequest(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anon) return false;
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("is_staff");
    return !error && data === true;
  } catch {
    return false;
  }
}

// The caller's tenant (profiles.tenant_id via their JWT). Service-role routes MUST scope their
// supabaseAdmin queries with this — the service role bypasses RLS, so tenancy is app-enforced
// there (the other half of risk R-002; the DB half is 0134). Fails closed (null).
export async function tenantFromRequest(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anon) return null;
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("current_tenant");
    return !error && typeof data === "string" && data ? data : null;
  } catch {
    return null;
  }
}

// THE CALLER, AS THEMSELVES (2026-10-12, 0391). A client on the anon key with the caller's own token, so a definer
// function's own check (is_admin(), is_staff()) decides what they may do — the database is the gate, not this route.
// Null with no session or no keys.
export function callerClient(req: Request): SupabaseClient | null {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Owner-or-admin gate (2026-10-14, 0400) — same shape as staffFromRequest but keys off is_admin() (0035: role owner or
// admin, or the legacy is_admin flag), the database's own word for who moves money back. A refund and a payment settled
// by hand (app/api/reserves/cancel for the crew, app/api/reserves/settle) are theirs, not every server's on the truck.
export async function adminFromRequest(req: Request): Promise<boolean> {
  try {
    const sb = callerClient(req);
    if (!sb) return false;
    const { data, error } = await sb.rpc("is_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}

// Owner-only gate — same shape as staffFromRequest but keys off is_owner().
export async function ownerFromRequest(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anon) return false;
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("is_owner");
    return !error && data === true;
  } catch {
    return false;
  }
}
