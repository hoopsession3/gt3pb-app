import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never be
// imported into client code. Used by the Square webhook (to write the read-only
// subscription mirror) and by subscription server routes. Null until the key is set.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
