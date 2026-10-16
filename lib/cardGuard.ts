import type { SupabaseClient } from "@supabase/supabase-js";

// A CARD TRIED HERE, COUNTED (R9, 2026-10-16 — the abuse audit's fifth).
//
// Only the cup and shop checkouts were guarded (their own buckets, which stay). A throwaway account could run stolen
// cards through every other card door — a pack, a Sunday delivery, a Limited Reserve, a pack made bigger, a
// subscription — one after another, and read Square's reason for each decline (lib/squareServer gave its words back
// as they came). Each of those doors asks this before Square is: a burst per person and per address, and a ceiling
// for everyone together, in the store every instance shares (rate_limit_hit, 0154 — true is UNDER the cap). A member
// paying, or tapping Pay again after a lost answer, never comes near it; a script does at once. Fails open when the
// store can't be asked — Square's own fraud tools are the backstop, as at the checkouts.
export const CARD_TRIES = { perPerson: 6, perAddress: 10, windowMs: 600_000, allPerMinute: 120 } as const;

export const CARD_TRIES_WORDS = "Too many card tries just now — give it a few minutes. Nothing was charged.";

/** The address a request came from, as the platform says it (Vercel sets x-forwarded-for; its first entry is the caller). */
export function callerAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
}

/** May this card try go to Square? False only when one of the counts is over. */
export async function cardTryFits(db: SupabaseClient, who: { userId?: string | null; ip: string }): Promise<boolean> {
  const asks = [
    db.rpc("rate_limit_hit", { p_bucket: `card:${who.ip}`, p_window_ms: CARD_TRIES.windowMs, p_max: CARD_TRIES.perAddress }),
    db.rpc("rate_limit_hit", { p_bucket: "card:all", p_window_ms: 60_000, p_max: CARD_TRIES.allPerMinute }),
  ];
  if (who.userId) asks.push(db.rpc("rate_limit_hit", { p_bucket: `card:u:${who.userId}`, p_window_ms: CARD_TRIES.windowMs, p_max: CARD_TRIES.perPerson }));
  const hits = await Promise.all(asks);
  return !hits.some((h) => (h as { data?: unknown }).data === false);
}
