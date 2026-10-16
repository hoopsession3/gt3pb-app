import type { SupabaseClient } from "@supabase/supabase-js";
import { callerIp, limitsFit, type Limit } from "./rateLimit";

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

/** The address a request came from, as the platform says it (lib/rateLimit.callerIp). */
export const callerAddress = callerIp;

/** The counts one card try is asked against, in order: the person, then the address, then everyone (R10). */
export function cardLimits(who: { userId?: string | null; ip: string }): Limit[] {
  return [
    ...(who.userId ? [{ bucket: `card:u:${who.userId}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.perPerson }] : []),
    { bucket: `card:${who.ip}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.perAddress },
    { bucket: "card:all", windowMs: 60_000, max: CARD_TRIES.allPerMinute },
  ];
}

/** May this card try go to Square? False at the first count that is over — the person's own before everyone's (R10). */
export async function cardTryFits(db: Pick<SupabaseClient, "rpc">, who: { userId?: string | null; ip: string }): Promise<boolean> {
  return limitsFit(db, cardLimits(who));
}
