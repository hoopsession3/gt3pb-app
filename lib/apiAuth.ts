import { supabaseAdmin } from "./supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

// Verify the caller's Supabase access token (sent as Authorization: Bearer <jwt>)
// and return their user id. Server-only. Returns null if missing/invalid.
export async function userFromRequest(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
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
