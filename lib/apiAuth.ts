import { supabaseAdmin } from "./supabaseAdmin";

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
