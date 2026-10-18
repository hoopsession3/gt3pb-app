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
// customer. Card testing is cards REFUSED, so R29 counted Square's refusals of a card for everyone together and paused
// every card door for the rest of a minute that held twenty. A try let through still counts against a ceiling no rush at
// a truck reaches (two hundred and forty a minute), so a script's tries alone can't grind through Square's limits either.
//
// THE PAUSE IS THE CALLER'S, NOT EVERYONE'S (R32, 2026-10-18 — the 10/10 audit, API11-01 and SEC11-02). A pause for
// everyone is a lever anyone can pull: one card token, tokenized for free and sent again, is refused as "used" every
// time, and four addresses at their own six a minute filled the twenty — every card door shut for every customer, for as
// long as the script ran, before 0434 was ever pasted. Now:
//   · a refusal is counted against who was refused — their person (signed in) and their address, four in the tries'
//     ten minutes — and only THEY are paused: asked before Square is, never counted (cardsPaused — rate_limit_peek, 0434).
//     A customer whose card is declined twice is still paying; a script testing cards from one address stops at four.
//   · a token Square won't take again (CARD_TOKEN_USED / CARD_TOKEN_EXPIRED) is the page's or the script's, not a card
//     refused: it pauses nobody (refusalKind). A card's own refusal — a decline, a number, a date — is the card's.
//   · everyone's refused cards are still counted, a minute at a time: twenty tell the crew (once an hour) that someone is
//     probably testing stolen cards — and pause nobody.
export const CARD_TRIES = { perPerson: 6, perAddress: 10, windowMs: 600_000, allPerMinute: 240, refusedPerCaller: 4, refusedAlertPerMinute: 20 } as const;

export const CARD_TRIES_WORDS = "Too many card tries just now — give it a few minutes. Nothing was charged.";
export const CARDS_PAUSED_WORDS = "Too many cards were refused from here just now — give it ten minutes, or try another way to pay. Nothing was charged.";

/** Who a card try or a refusal is counted against: their person, when signed in, and their address. */
export type CardCaller = { userId?: string | null; ip: string };

/** The cards Square refused one caller, in the tries' window — their person's and their address's (R32). */
export function refusedLimits(who: CardCaller): Limit[] {
  return [
    ...(who.userId ? [{ bucket: `card:refused:u:${who.userId}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.refusedPerCaller }] : []),
    { bucket: `card:refused:${who.ip}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.refusedPerCaller },
  ];
}

/** Everyone's refused cards, a minute at a time: the crew told past twenty — never a pause (R32). */
export const REFUSED_ALL: Limit = { bucket: "card:refused", windowMs: 60_000, max: CARD_TRIES.refusedAlertPerMinute };

/** The address a request came from, as the platform says it (lib/rateLimit.callerIp). */
export const callerAddress = callerIp;

/** The counts one card try is asked against, in order: the person, then the address, then everyone (R10). */
export function cardLimits(who: CardCaller): Limit[] {
  return [
    ...(who.userId ? [{ bucket: `card:u:${who.userId}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.perPerson }] : []),
    { bucket: `card:${who.ip}`, windowMs: CARD_TRIES.windowMs, max: CARD_TRIES.perAddress },
    { bucket: "card:all", windowMs: 60_000, max: CARD_TRIES.allPerMinute },
  ];
}

/** True while this caller's refused cards are at their ceiling — asked, never counted (rate_limit_peek, 0434). Fails
 *  open: a store that can't be asked, or one before 0434, pauses nothing (the person's and the address's tries still stand). */
export async function cardsPaused(db: Pick<SupabaseClient, "rpc">, who: CardCaller): Promise<boolean> {
  for (const l of refusedLimits(who)) {
    try {
      const { data, error } = await db.rpc("rate_limit_peek", { p_bucket: l.bucket, p_window_ms: l.windowMs, p_max: l.max });
      if (!error && data === false) return true;
    } catch { /* not asked: not paused */ }
  }
  return false;
}

/** A card Square refused this caller, counted against them — and against everyone's minute, which tells the crew (once an
 *  hour, in the running app only — a test compiles this file alone) when it passes twenty. Never throws. */
export async function cardRefused(db: Pick<SupabaseClient, "rpc">, who: CardCaller, now: Date = new Date()): Promise<void> {
  await limitsFit(db, refusedLimits(who));   // counted; their answer is cardsPaused's to read
  if (await limitsFit(db, [REFUSED_ALL])) return;
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME) {
    await import("./serverAlerts").then((m) => m.raiseAlertOnce({
      severity: "critical", category: "money", kind: "cards_refused", subjectId: `cards-refused:${now.toISOString().slice(0, 13)}`,
      title: "Many cards refused — someone may be testing cards",
      body: `Square refused ${CARD_TRIES.refusedAlertPerMinute} cards within a minute. Each address and account refused ${CARD_TRIES.refusedPerCaller} times is paused for ten minutes; everyone else still pays. If it keeps on, look at Square's Risk Manager.`,
      link: "/crew?s=money&a=pay",
    })).catch(() => { /* the count stands; the alert is a courtesy */ });
  }
}

/** This caller paused: the words they are told. Null while they aren't. */
export async function cardsPausedRefusal(db: Pick<SupabaseClient, "rpc">, who: CardCaller): Promise<string | null> {
  return (await cardsPaused(db, who)) ? CARDS_PAUSED_WORDS : null;
}

/** May this card try go to Square? Null, or what the person is told: this caller paused (their refused cards), then the
 *  person's tries, the address's, and everyone's — the caller's own before everyone's (R10). */
export async function cardTryRefusal(db: Pick<SupabaseClient, "rpc">, who: CardCaller): Promise<string | null> {
  const paused = await cardsPausedRefusal(db, who);
  if (paused) return paused;
  return (await limitsFit(db, cardLimits(who))) ? null : CARD_TRIES_WORDS;
}
