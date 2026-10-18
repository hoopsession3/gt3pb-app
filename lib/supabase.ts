import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Read before the client below takes a sign-in's session out of the address (R9, lib/linkSignin): this import runs first.
import { answerInFragmentOnly } from "./linkSignin";
import { dbDeadlineFor, withDeadline } from "./deadline";
import { reportFailingAnswers } from "./failureReport";
import type { Database } from "./database.types";

// Browser Supabase client. Returns null until the env keys are set, so importing
// this never crashes the build/UI — callers gate on `supabaseEnabled`.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && anon);

export const supabase: SupabaseClient<Database> | null = supabaseEnabled
  ? createClient<Database>(url as string, anon as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // From the fragment only, never the query string (R24 — security F8; lib/linkSignin answerInFragmentOnly).
        detectSessionInUrl: (url) => answerInFragmentOnly(url),
        // implicit flow: token arrives in the URL fragment, so a magic link works even when
        // opened in a different browser/app than it was requested from (no PKCE verifier needed).
        flowType: "implicit",
      },
      // Every read, write, refresh and file has a deadline (R11, lib/deadline): a hung write on the Pass now errors as
      // no signal does, and is queued, instead of hanging neither saved nor queued. Every answer the database refused is
      // reported at this door (R18, lib/failureReport), whoever asked — a missing column is never a quiet empty screen.
      global: { fetch: reportFailingAnswers(withDeadline(dbDeadlineFor)) },
    })
  : null;
