// DELETING AN ACCOUNT, IN ITS ORDER (2026-10-15, A3 of the account audit: "deletion finishes the database erase before
// cancelling anything outside it").
//
// The database goes first. Deleting the account (Supabase's admin API) runs 0353's erasure and, in the same transaction,
// 0404's trigger, which writes what is left to do outside the database — the membership's cancel at Square, the Square
// profile that holds a saved card, the token Sign in with Apple gave GT3, each photo — marked with this deletion's ticket.
// A refused erasure (an order placed a moment ago) rolls all of it back: nothing outside the database has been touched.
// Then those steps, each tried twice; one that still fails goes to the crew by an alert saying what to do by hand (0404
// erasure_followup_alert), and the watch hands over anything this never reached.
//
// Every step is handed in: app/api/account/erase gives the real ones; scripts/accounterase.test.mjs stands in for them.
//
// arrives-with: 0404 — until it is pasted there is no queue: claim answers null, and what was read before the delete (the
// Square profile, the Apple token, the photos — a billing membership still refuses the delete there, as 0353 did) is done
// directly, each failure alerted as before. The commit that records 0404 applied takes this out.

import { errorMessage } from "./errorMessage";

export type Blocker = { code: string; message: string };
export type Followup = { id: string; kind: "square_subscription" | "square_customer" | "apple_token" | "photo"; ref: string; direct?: true };
export type EraseSteps = {
  /** What stands in the way (0404 account_erasure_blockers), or null when it could not be asked. */
  blockers(userId: string): Promise<Blocker[] | null>;
  /** Whether the account signs in with Apple. */
  hasApple(userId: string): Promise<boolean>;
  /** A mark for this deletion's own rows, written on the account (app_metadata.erasure_ticket). */
  newTicket(): string;
  markTicket(userId: string, ticket: string): Promise<boolean>;
  /** What lies outside the database for the account, read before it goes — done directly when there is no queue yet
   *  (arrives-with: 0404). */
  outside(userId: string): Promise<Followup[]>;
  /** Delete the account: 0353's erasure and 0404's queue, in one transaction. */
  deleteAccount(userId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** This deletion's rows (0404 claim_erasure_followups) — null when there is no queue (0404 not pasted yet). */
  claim(ticket: string): Promise<Followup[] | null>;
  /** One step outside the database: Square, Apple or storage. */
  run(f: Followup): Promise<{ ok: boolean; error?: string }>;
  /** Done (the row goes) or not (said why). */
  finish(f: Followup, ok: boolean, error?: string): Promise<void>;
  /** To the crew, by an alert (an Apple token is let go: the person is told how to end it in Settings). */
  handOff(f: Followup): Promise<void>;
};
export type EraseAnswer = {
  status: number;
  body: { ok: true; appleManual: boolean; membershipPending: boolean } | { error: string; blockers?: Blocker[] };
  /** Set when the database refused for no reason it can name: the route files it as an error. */
  thrown?: string;
};

export const ERASE_WORDS = {
  unavailable: "Deleting an account isn't available yet. Try again later today.",
  busy: "We couldn't start deleting your account just now. Nothing was deleted — try again in a minute.",
} as const;

const TRIES = 2;

/** Delete the account, then do what is left outside the database. */
export async function eraseAccount(userId: string, steps: EraseSteps): Promise<EraseAnswer> {
  // 1 · what stands in the way, answered before anything changes
  const first = await steps.blockers(userId);
  if (!first) return { status: 503, body: { error: ERASE_WORDS.unavailable } };
  if (first.length) return { status: 409, body: { error: first[0].message, blockers: first } };

  // 2 · read before the account goes
  const apple = await steps.hasApple(userId);
  const before = await steps.outside(userId);   // arrives-with: 0404
  const ticket = steps.newTicket();
  if (!(await steps.markTicket(userId, ticket))) return { status: 503, body: { error: ERASE_WORDS.busy } };

  // 3 · the database: the erasure, and the queue of what is outside it — all of it, or none of it
  const gone = await steps.deleteAccount(userId);
  if (!gone.ok) {
    // Supabase reports every refusal as "Database error deleting user", so ask again what stands in the way: an order
    // placed a moment ago, say.
    const now = (await steps.blockers(userId)) ?? [];
    if (now.length) return { status: 409, body: { error: now[0].message, blockers: now } };
    return { status: 500, body: { error: ERASE_WORDS.busy }, thrown: `account erase: deleteUser failed — ${gone.error}` };
  }

  // 4 · what is outside it, each step tried twice; one still failing goes to the crew
  let membershipPending = false;
  let appleRevoked = false;
  const queued = await steps.claim(ticket);
  for (const f of queued ?? before.map((b) => ({ ...b, direct: true as const }))) {
    let done = { ok: false, error: "not tried" } as { ok: boolean; error?: string };
    for (let i = 0; i < TRIES && !done.ok; i++) done = await steps.run(f).catch((e: unknown) => ({ ok: false, error: errorMessage(e, 300) }));
    await steps.finish(f, done.ok, done.ok ? undefined : done.error);
    if (done.ok) { if (f.kind === "apple_token") appleRevoked = true; continue; }
    if (f.kind === "square_subscription") membershipPending = true;
    await steps.handOff(f);
  }

  // Signed in with Apple, and Apple wasn't told: the one step left is the person's, in the iPhone's Settings (TN3194).
  return { status: 200, body: { ok: true, appleManual: apple && !appleRevoked, membershipPending } };
}
