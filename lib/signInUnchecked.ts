// A SIGN-IN THAT COULDN'T BE CHECKED (R16, 2026-10-17 — the 10/10 audit, API F13, the rest of it).
//
// lib/apiAuth.userFromRequest answered null both for "no session" and for "the auth service did not answer", and every
// route read null as no session: during an auth blip a member asking to cancel an order, pay for a reserve, move a pack,
// change their texts or erase their account was told "sign in" while signed in — and a door that prices by who is
// asking (the quotes) priced them as a guest. R15 gave the four card checkouts their own answer (callerFromRequest's
// "unavailable"). For the other thirty-one doors the answer is this: userFromRequest throws it, and the route wrapper
// (lib/apiRoute) — which every handler is exported through — answers 503 with these words, files no crash (the fault is
// the auth service's, and a blip would file one per door), and writes one line to the platform's log.
//
// Its own file, with no imports, so the wrapper can know it without loading the auth client.
export const SIGN_IN_UNCHECKED_ANY = "We couldn't check your sign-in just now — nothing was changed. Try again in a moment.";

export class SignInUnchecked extends Error {
  constructor(detail = "the auth service did not answer") {
    super(`sign-in unchecked: ${detail}`);
    this.name = "SignInUnchecked";
  }
}

/** True for the error userFromRequest throws when a bearer was sent and the auth service could not say whose it is. */
export const isSignInUnchecked = (e: unknown): e is SignInUnchecked =>
  e instanceof SignInUnchecked || (e instanceof Error && e.name === "SignInUnchecked");
