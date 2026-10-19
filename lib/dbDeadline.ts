// A DEADLINE ON THE SERVER'S OWN DATABASE CALLS (R39 — the fresh audit's API11-10).
//
// Every provider the server calls had a deadline (Square 20 s, Resend and Twilio 10, Graph 15, Apliiq 25, Anthropic 45);
// the database had none. When PostgREST's pool ran dry, a card checkout's claims read hung until the platform killed the
// request at 60 seconds, and the page got the platform's own 504 — not the checkout's clean 503, "nothing was charged" —
// a route with no maxDuration of its own hung longer, and /api/health hung instead of telling the monitor 503.
//
// The server's clients (lib/supabaseAdmin, lib/apiAuth's callerClient, the routes that make their own) hand this fetch to
// supabase-js: a call that runs past DB_DEADLINE_MS is aborted, and supabase-js answers it as an error with status 0 — the
// "no answer" every reader here already says as such (lib/apiAuth: SignInUnchecked, a 503). A signal the caller passes
// still works: whichever fires first ends the call. Read at call time, so a test's stand-in fetch is the one used.
export const DB_DEADLINE_MS = 15_000;

export function deadlineFetch(ms: number = DB_DEADLINE_MS): typeof fetch {
  return (input, init) => {
    const limit = AbortSignal.timeout(ms);
    const own = init?.signal ?? null;
    const signal = own ? AbortSignal.any([own, limit]) : limit;
    return globalThis.fetch(input, { ...init, signal });
  };
}
