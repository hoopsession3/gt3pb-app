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
//
// A CEILING ASKED OF WHAT HAPPENED, NOT OF EVERY TRY (R29, 2026-10-18 — the 10/10 audit, API F1). The ceiling for everyone
// together counted every try: a handful of addresses, each under its own count, kept card payments shut for every
// customer. Card testing is cards REFUSED — so Square's refusals of a card are counted for everyone together (cardRefused,
// lib/squareServer chargeCard), and once a minute holds twenty, card payments pause for the rest of it: asked before Square
// is, never counted (cardsPaused — rate_limit_peek, 0434), and the crew told once an hour. A try let through still counts
// against a ceiling no rush at a truck reaches (two hundred and forty a minute), so a script's tries alone can't grind
// through Square's limits for the account either.
export const CARD_TRIES = { perPerson: 6, perAddress: 10, windowMs: 600_000, allPerMinute: 240, refusedPerMinute: 20 } as const;

export const CARD_TRIES_WORDS = "Too many card tries just now — give it a few minutes. Nothing was charged.";
export const CARDS_PAUSED_WORDS = "Card payments are paused for a minute — too many cards were refused just now. Nothing was charged; try again in a minute.";

/** The minute's cards Square refused, everyone's together (cardRefused counts; cardsPaused asks). */
export const REFUSED = { bucket: "card:refused", windowMs: 60_000 } as const;

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

/** True while the minute's refused cards are at the ceiling — asked, never counted (rate_limit_peek, 0434). Fails open: a
 *  store that can't be asked, or one before 0434, pauses nothing (the person's and the address's counts still stand). */
export async function cardsPaused(db: Pick<SupabaseClient, "rpc">): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("rate_limit_peek", { p_bucket: REFUSED.bucket, p_window_ms: REFUSED.windowMs, p_max: CARD_TRIES.refusedPerMinute });
    return !error && data === false;
  } catch { return false; }
}

/** A card Square refused (its decline, or a card entry it would not take), counted for everyone together. Never throws. */
export async function cardRefused(db: Pick<SupabaseClient, "rpc">): Promise<void> {
  await limitsFit(db, [{ bucket: REFUSED.bucket, windowMs: REFUSED.windowMs, max: CARD_TRIES.refusedPerMinute }]);   // counted; its answer is cardsPaused's to read
}

/** Card payments paused: the words, and the crew told — once an hour (raiseAlertOnce), in the running app only (a test
 *  compiles this file alone). Null while they aren't. */
export async function cardsPausedRefusal(db: Pick<SupabaseClient, "rpc">, now: Date = new Date()): Promise<string | null> {
  if (!(await cardsPaused(db))) return null;
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME) {
    await import("./serverAlerts").then((m) => m.raiseAlertOnce({
      severity: "critical", category: "money", kind: "cards_paused", subjectId: `cards-paused:${now.toISOString().slice(0, 13)}`,
      title: "Card payments paused — many cards refused",
      body: `Square refused ${CARD_TRIES.refusedPerMinute} cards within a minute, so card payments are paused for the rest of it — they start again by themselves each minute. A burst like this is usually someone testing stolen cards; if it keeps on, look at Square's Risk Manager.`,
      link: "/crew?s=money&a=pay",
    })).catch(() => { /* the pause stands; the alert is a courtesy */ });
  }
  return CARDS_PAUSED_WORDS;
}

/** May this card try go to Square? Null, or what the person is told: card payments paused (the minute's refused cards),
 *  then the person's tries, the address's, and everyone's — the caller's own before everyone's (R10). */
export async function cardTryRefusal(db: Pick<SupabaseClient, "rpc">, who: { userId?: string | null; ip: string }, now: Date = new Date()): Promise<string | null> {
  const paused = await cardsPausedRefusal(db, now);
  if (paused) return paused;
  return (await limitsFit(db, cardLimits(who))) ? null : CARD_TRIES_WORDS;
}
