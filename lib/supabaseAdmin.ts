import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { deadlineFetch } from "./dbDeadline";

// Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never be
// imported into client code. Used by the Square webhook (to write the read-only
// subscription mirror) and by subscription server routes. Null until the key is set.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin: SupabaseClient<Database> | null =
  url && serviceKey
    // Every call with a deadline (R39 — API11-10, lib/dbDeadline): a database that doesn't answer is an error, not a hang.
    ? createClient<Database>(url, serviceKey, { global: { fetch: deadlineFetch() }, auth: { persistSession: false, autoRefreshToken: false } })
    : null;
