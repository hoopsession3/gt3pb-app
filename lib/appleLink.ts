// JOINING AN APPLE ID TO THE ACCOUNT IT BELONGS TO (2026-10-15, A3 of the account audit; decided by Ryan on 2026-10-13).
//
// Sign in with Apple can hide a person's email behind a private relay address, which matches nobody's — so a member who
// joined with their email and then tapped Continue with Apple got a second, empty account. The member now proves both:
// their email account by its code (they are signed in to it when they ask), and the Apple ID by a fresh identity token
// from Apple's sheet. This decides, in order, with every step it takes handed in (app/api/account/link-apple gives the
// real ones; scripts/applelink.test.mjs stands in for them):
//
//   1. the token is Apple's, for this app, current, for this nonce (lib/appleSignIn verifyIdentityToken) — or nothing;
//   2. the caller signs in with their email, and has no other Apple ID; this one already theirs is done;
//   3. Supabase links it (manual linking). Linked: done. Linking switched off: nothing changes, and it says so;
//   4. the Apple ID already opens another account: joined only when that account holds nothing a person would lose
//      (0403 account_unused) and signs in with Apple alone — its Apple token moves across first (so deleting it does not
//      queue a revoke, 0404), the account is deleted (0353's erasure), and Supabase links again.
// A step that fails before the delete changes nothing; one after it says how to finish (Link Sign in with Apple, in
// Settings & privacy, which asks this again — now with nothing in the way).

export type LinkError = { code: string; message: string };
export type LinkSteps = {
  /** Apple's sub for the identity token, or null when it is not one (lib/appleSignIn verifyIdentityToken). */
  verify(idToken: string, nonce: string): Promise<{ sub: string } | null>;
  /** The account's identities as Supabase keeps them — provider, and the Apple sub for an Apple one — or null if unread. */
  identitiesOf(userId: string): Promise<Array<{ provider: string; sub: string }> | null>;
  /** Supabase links the Apple ID to the caller (token?grant_type=id_token, link_identity) with the caller's own session. */
  link(jwt: string, idToken: string, nonce: string): Promise<{ ok: true } | ({ ok: false } & LinkError)>;
  /** The account the Apple ID signs in to (0403 account_for_apple). */
  accountForApple(sub: string): Promise<string | null>;
  /** Whether that account holds nothing a person would lose (0403 account_unused). */
  unused(userId: string): Promise<boolean>;
  /** The Apple token kept for revoking (0363), from one account to the other — unless the other has its own. True when
   *  one moved. */
  moveAppleToken(from: string, to: string): Promise<boolean>;
  /** Delete the account (Supabase's admin API; 0353's erasure runs with it). */
  deleteAccount(userId: string): Promise<{ ok: boolean; error?: string }>;
};
export type LinkAnswer = { status: number; body: { ok: true; joined: boolean; already?: true } | { error: string; code?: string } };

export const LINK_WORDS = {
  token: "Apple didn't confirm that sign-in. Try again.",
  notEmail: "Link Sign in with Apple from the account you signed in to with your email.",
  otherApple: "This account already signs in with a different Apple ID.",
  off: "Linking Sign in with Apple isn't switched on yet. Your accounts are as they were.",
  busy: "Sign in with Apple couldn't be linked just now. Nothing changed — try again in a minute.",
  used: "That Apple ID already has its own GT3 account with orders or rewards on it, so it can't be joined here. Ask us at the truck and we'll join them.",
  linkedElsewhere: "That Apple ID is already linked to another GT3 account.",
  deleteFailed: "Your accounts couldn't be joined just now. Nothing changed — try again in a minute.",
  finish: "Almost: your Apple ID is free now, but Apple's link didn't finish. Tap Link Sign in with Apple in Settings & privacy to finish.",
} as const;

const fail = (status: number, message: string, code?: string): LinkAnswer => ({ status, body: code ? { error: message, code } : { error: message } });

/** Join the Apple ID in the identity token to the signed-in caller's account. */
export async function linkApple(caller: { id: string; jwt: string }, idToken: string, nonce: string, steps: LinkSteps): Promise<LinkAnswer> {
  // 1 · the token
  const apple = await steps.verify(idToken, nonce);
  if (!apple) return fail(400, LINK_WORDS.token, "token");

  // 2 · the caller
  const mine = await steps.identitiesOf(caller.id);
  if (!mine) return fail(503, LINK_WORDS.busy, "busy");
  if (mine.some((i) => i.provider === "apple" && i.sub === apple.sub)) return { status: 200, body: { ok: true, joined: false, already: true } };
  if (mine.some((i) => i.provider === "apple")) return fail(409, LINK_WORDS.otherApple, "other_apple");
  if (!mine.some((i) => i.provider === "email")) return fail(409, LINK_WORDS.notEmail, "not_email");

  // 3 · Supabase links it
  const first = await steps.link(caller.jwt, idToken, nonce);
  if (first.ok) return { status: 200, body: { ok: true, joined: false } };
  if (first.code === "manual_linking_disabled") return fail(503, LINK_WORDS.off, "off");
  if (first.code !== "identity_already_exists") return fail(502, LINK_WORDS.busy, "busy");

  // 4 · it opens another account
  const other = await steps.accountForApple(apple.sub);
  if (other === caller.id) return { status: 200, body: { ok: true, joined: false, already: true } };
  if (!other) return fail(502, LINK_WORDS.busy, "busy");   // gone between the two asks: asking again links it
  const theirs = await steps.identitiesOf(other);
  if (!theirs) return fail(503, LINK_WORDS.busy, "busy");
  if (theirs.some((i) => i.provider !== "apple")) return fail(409, LINK_WORDS.linkedElsewhere, "linked_elsewhere");
  if (!(await steps.unused(other))) return fail(409, LINK_WORDS.used, "used");

  const moved = await steps.moveAppleToken(other, caller.id);
  const gone = await steps.deleteAccount(other);
  if (!gone.ok) {
    if (moved) await steps.moveAppleToken(caller.id, other).catch(() => false);   // back where it was
    return fail(502, LINK_WORDS.deleteFailed, "busy");
  }

  const second = await steps.link(caller.jwt, idToken, nonce);
  if (second.ok) return { status: 200, body: { ok: true, joined: true } };
  return fail(502, LINK_WORDS.finish, "finish");
}
