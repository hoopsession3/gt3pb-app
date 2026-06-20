import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client. Returns null until the env keys are set, so importing
// this never crashes the build/UI — callers gate on `supabaseEnabled`.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && anon);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anon as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
