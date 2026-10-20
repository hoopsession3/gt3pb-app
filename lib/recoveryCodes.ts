// TWO-STEP RECOVERY CODES (R37, 2026-10-19 — the fresh audit's UX11-10; Ryan: "Recovery codes"). Server-only.
//
// Ten one-time codes for each person who sets up an authenticator (0438 two_step_recovery_codes), shown to them once.
// Any one of them, on a sign-in proved in the last few minutes, takes the lost authenticator off their account
// (app/api/two-step/recover). What is kept is each code's hash with its own salt — scrypt, slow on purpose, so a copy of
// the table is no list of codes — never the code, never in a log.
//
// A code is ten characters from the 31 that can't be misread on paper or a screen (no 0 or O, no 1, I or L), about 50
// bits, shown in two fives: ABCDE-23456. Typed or pasted, its dashes, spaces and lower-case letters don't matter.
import { randomBytes, randomInt, scryptSync } from "node:crypto";
import { sameBytes } from "./webhookSignature";

export const RECOVERY_COUNT = 10;
export const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_LEN = 10;
// scrypt's cost: 2^14 × 8 — about 16 MB and a few tens of milliseconds a code, here and for anyone holding a copy.
const N = 16384, R = 8, P = 1, KEY = 32;

/** One code, as shown: ABCDE-23456. */
export function makeCode(): string {
  let s = "";
  for (let i = 0; i < RECOVERY_LEN; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** A person's ten, no two alike. */
export function makeCodes(n: number = RECOVERY_COUNT): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(makeCode());
  return [...out];
}

/** A code as typed or pasted: its letters and digits, upper case. Pure. */
export const codeOf = (typed: unknown): string => String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Whether what was typed can be a code at all — ten of the alphabet's characters. Pure. */
export function looksLikeCode(typed: unknown): boolean {
  const c = codeOf(typed);
  return c.length === RECOVERY_LEN && [...c].every((ch) => RECOVERY_ALPHABET.includes(ch));
}

/** What the table keeps for a code: "s1$<salt>$<hash>", base64url. */
export function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(codeOf(code), salt, KEY, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `s1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Whether a typed code is the one a kept hash was made from. Constant-time over the hash (lib/webhookSignature sameBytes —
 *  the app's one constant-time compare); false for anything malformed, and never a throw. */
export function codeMatches(typed: unknown, kept: string): boolean {
  const [v, s, h] = String(kept ?? "").split("$");
  if (v !== "s1" || !s || !h) return false;
  if (Buffer.from(h, "base64url").length !== KEY) return false;
  const got = scryptSync(codeOf(typed), Buffer.from(s, "base64url"), KEY, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return sameBytes(got.toString("base64url"), h);
}

/** The words a person reads, in the app's voice. */
export const RECOVERY_WORDS = {
  notCode: "That isn't a recovery code — it's ten letters and numbers, like ABCDE-23456.",
  wrong: "That recovery code didn't work. Check it, or try another of yours.",
  none: "There are no recovery codes on this account. The owner can take your authenticator off in Supabase (Authentication → Users).",
  fresh: "Sign in again first — a recovery code is taken only on a sign-in from the last few minutes.",
  giveCode: "Give your authenticator's code on this sign-in first, then make new recovery codes.",
  tooMany: "Too many tries — wait an hour, then try again.",
  nothingOn: "There's no authenticator on your account to take off",
} as const;
