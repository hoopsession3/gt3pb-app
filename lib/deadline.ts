// ═══ DEADLINES IN THE BROWSER (R11, 2026-10-16 — the 10/10 audit) ════════════════════════════════════════════════════
// Nothing the app asked of the network ever gave up. On truck LTE a request can go out and its answer never come back,
// and the browser waits as long as it likes — about a minute on an iPhone, minutes elsewhere: Pay spinning in a sheet
// whose every way out is held until the charge answers, a Pass move neither saved nor queued (the queue is taken only on
// an error, and a hung write is not one). Every call out of the browser has a deadline now:
//  · the database (lib/supabase) — DB_DEADLINE_MS for a read, a write or a sign-in refresh (Postgres itself stops a
//    signed-in statement at 8 s), FILE_DEADLINE_MS for a photo going up or coming down;
//  · the app's own routes (lib/authedFetch) — ROUTE_DEADLINE_MS, past the longest any route may run (120 s), and
//    PAY_DEADLINE_MS on the payment POSTs, past the server's own Square deadlines (lib/squareServer, 20 s a call).
// A deadline that runs out throws as no signal does — a TypeError whose words say "timed out", which
// components/offline's isNetworkError reads as no signal — so a write that ran out of time takes the road one with no bars
// takes: queued on the Pass, "tap Pay to retry — you won't be charged twice" at checkout.
// AbortSignal.timeout is iOS 16 and the iPhone app still opens on iOS 15, so this is a timer and a controller of its own,
// cleared the moment the answer starts: a slow download is not cut off, a silent server is.
export const DB_DEADLINE_MS = 20_000;
export const FILE_DEADLINE_MS = 120_000;
export const ROUTE_DEADLINE_MS = 130_000;
export const PAY_DEADLINE_MS = 45_000;

/** The words a deadline throws with — read as no signal by components/offline's isNetworkError. */
export const timedOutWords = (ms: number) => `Network request timed out — no answer in ${Math.round(ms / 1000)} s`;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A fetch that gives up when no answer has started within `ms` (a number, or one chosen per request). A caller's own
 *  signal is left alone — two signals can't be joined on the iPhones that lack AbortSignal.any — and so is a browser
 *  without AbortController. `base` is read at call time, so a fetch the native shell swaps in later is still the one used. */
export function withDeadline(ms: number | ((url: string) => number), base?: Fetch): Fetch {
  return async (input, init) => {
    const send: Fetch = base ?? ((i, o) => globalThis.fetch(i, o));
    if (init?.signal || typeof AbortController === "undefined") return send(input, init);
    const limit = typeof ms === "function" ? ms(urlOf(input)) : ms;
    const ctrl = new AbortController();
    let ran = false;
    const timer = setTimeout(() => { ran = true; ctrl.abort(); }, limit);
    try {
      return await send(input, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (ran) throw new TypeError(timedOutWords(limit));
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url ?? "";
}

/** The database's deadline for one request: a file under Storage gets the long one, everything else the short one. */
export function dbDeadlineFor(url: string): number {
  return /\/storage\/v1\//.test(url) ? FILE_DEADLINE_MS : /\/functions\/v1\//.test(url) ? ROUTE_DEADLINE_MS : DB_DEADLINE_MS;
}
