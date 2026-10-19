import { supabaseAdmin } from "./supabaseAdmin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deadlineFetch } from "./dbDeadline";
import { authUnavailable } from "./authAnswer";
import { SignInUnchecked } from "./signInUnchecked";
import { claimsOf, provedWithin, PROVED_FOR_S } from "./freshProof";

// Verify the caller's Supabase access token (sent as Authorization: Bearer <jwt>)
// and return their user id and verified email. Server-only. Returns null if missing/invalid.
//
// The email is here so a route that needs it (app/api/office seeds a standing account's contact
// from it) reads it from the SAME verified session as the id, never from the client body — and
// never by re-implementing this token check inline. This is the one place a route reads a session;
// scripts/api.audit.mjs does not accept an inline `.auth.getUser(` as a guard.
//
// A BEARER THE AUTH SERVICE COULDN'T CHECK THROWS (R16 — the 10/10 audit, API F13). Null is "no session": no bearer, or
// one the service refused. A bearer sent while the service did not answer (lib/authAnswer) is neither, and the caller
// is not told to sign in: it throws SignInUnchecked, which the route wrapper (lib/apiRoute) answers 503, "nothing was
// changed". Every caller is a handler exported through that wrapper (scripts/api.audit.mjs holds every one to it).
export async function userFromRequest(req: Request): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !supabaseAdmin) return null;
  let answer: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>;
  try {
    answer = await supabaseAdmin.auth.getUser(token);
  } catch (e) {
    throw new SignInUnchecked(e instanceof Error ? e.message.slice(0, 120) : "the auth service threw");
  }
  const { data, error } = answer;
  if (data?.user) return { id: data.user.id, email: data.user.email ?? null };
  if (authUnavailable(error)) throw new SignInUnchecked(error?.message?.slice(0, 120));
  return null;
}

// PROVED JUST NOW (R27 — the 10/10 audit, security F7; lib/freshProof). Whether the caller proved it is them in the last
// few minutes — an emailed code, Apple, a password — read from the same bearer userFromRequest checked. Ask it only after
// userFromRequest answered a person for this same request: the claims are read here, not checked.
export function bearerProvedWithin(req: Request, windowS: number = PROVED_FOR_S): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!token && provedWithin(claimsOf(token), Date.now(), windowS);
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
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: deadlineFetch() },   // a deadline (R39 — API11-10)
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A DEFINER FUNCTION ASKED AS THE CALLER, AND AN ANSWER THAT NEVER CAME (R16 — the 10/10 audit, API F13). The four gates
// below ask the database who is calling (is_staff, is_admin, is_owner, current_tenant) and read any failure as "no": during
// a database blip the crew were told "staff only" — and a manager "owner-only" — while signed in as who they are. A
// refusal (a 4xx: an expired or forged token) is still "no". The database not answering — the network, a deadline
// (postgrest-js says both as status 0) or a 5xx — is neither, and throws SignInUnchecked: the route wrapper answers it 503,
// "nothing was changed". Null: no bearer, or no keys.
async function askAsCaller(req: Request, fn: "is_staff" | "is_admin" | "is_owner" | "current_tenant"): Promise<{ data: unknown; error: unknown } | null> {
  const sb = callerClient(req);
  if (!sb) return null;
  let r: { data: unknown; error: unknown; status: number };
  try {
    r = await sb.rpc(fn);
  } catch (e) {
    throw new SignInUnchecked(`${fn} threw: ${e instanceof Error ? e.message.slice(0, 100) : "no answer"}`);
  }
  if (r.error && (r.status === 0 || r.status >= 500)) throw new SignInUnchecked(`${fn} answered ${r.status || "nothing"}`);
  return r;
}

// Staff-only gate for internal READ routes (assets, inventory) so they never return
// business data to a guest/member JWT. Uses the caller's token with the anon client +
// is_staff() (SECURITY DEFINER, keys off auth.uid()) — works without the service-role
// key, so it only needs the always-present anon key. Fails closed: a refusal is false; a database that did not answer
// throws SignInUnchecked (above).
export async function staffFromRequest(req: Request): Promise<boolean> {
  const r = await askAsCaller(req, "is_staff");
  return !!r && !r.error && r.data === true;
}

// The caller's tenant (profiles.tenant_id via their JWT). Service-role routes MUST scope their
// supabaseAdmin queries with this — the service role bypasses RLS, so tenancy is app-enforced
// there (the other half of risk R-002; the DB half is 0134). Fails closed (null) — and throws SignInUnchecked when the
// database did not answer (above), so "no tenant on this session" is never said to someone who has one.
export async function tenantFromRequest(req: Request): Promise<string | null> {
  const r = await askAsCaller(req, "current_tenant");
  return r && !r.error && typeof r.data === "string" && r.data ? r.data : null;
}

// Owner-or-admin gate (2026-10-14, 0400) — same shape as staffFromRequest but keys off is_admin() (0035: role owner or
// admin, or the legacy is_admin flag), the database's own word for who moves money back. A refund and a payment settled
// by hand (app/api/reserves/cancel for the crew, app/api/reserves/settle) are theirs, not every server's on the truck.
export async function adminFromRequest(req: Request): Promise<boolean> {
  const r = await askAsCaller(req, "is_admin");
  return !!r && !r.error && r.data === true;
}

// Owner-only gate — same shape as staffFromRequest but keys off is_owner().
export async function ownerFromRequest(req: Request): Promise<boolean> {
  const r = await askAsCaller(req, "is_owner");
  return !!r && !r.error && r.data === true;
}
