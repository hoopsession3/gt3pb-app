import type { SupabaseClient } from "@supabase/supabase-js";

// ONE CALLER'S LIMIT BEFORE EVERYONE'S (R10, 2026-10-16 — the 10/10 audit of the back end).
//
// A door with a limit for each caller and a ceiling for everyone together asked both at once, and the store counted every
// try — the ones it refused too (rate_limit_hit, 0154). So one script from one address, long past its own limit, kept
// spending the count every customer shares: sixty-one tiny posts a minute closed card checkout for everybody. Now the
// limits are asked in order — the caller's own first, everyone's last — and the first one over stops the asking: a try
// refused by its own limit never reaches the shared one, and the store no longer counts a refused try at all (0419).
//
// Fails open when the store cannot be asked (an error or a throw, not a "no"): a store outage is not a reason to turn a
// customer away, and at the card doors Square's own fraud tools are the backstop, as before. A limit the store could not
// be asked about is passed over and the next one is still asked.
export type Limit = { bucket: string; windowMs: number; max: number };

/** Do these tries fit, asked in order (most particular first)? False at the first limit that is over. */
export async function limitsFit(db: Pick<SupabaseClient, "rpc">, limits: readonly Limit[]): Promise<boolean> {
  for (const l of limits) {
    let over = false;
    try {
      const { data, error } = await db.rpc("rate_limit_hit", { p_bucket: l.bucket, p_window_ms: l.windowMs, p_max: l.max });
      over = !error && data === false;
    } catch { over = false; }
    if (over) return false;
  }
  return true;
}

/** The address a request came from, as the platform says it (Vercel sets x-forwarded-for; its first entry is the caller). */
export function callerIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
}
