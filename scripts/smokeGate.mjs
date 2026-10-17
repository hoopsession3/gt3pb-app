// WHETHER THE SIGNED-IN SMOKE CAN RUN (R14, 2026-10-17 — the 10/10 audit's operations pass, F9).
//
// scripts/smoke.authed.mjs said NOT CHECKED and exited 0 in two cases that are not the same case:
//
//   no account at all          — a fork, a laptop, a repository before its secrets: nobody asked for the check. Saying so
//                                and passing is right.
//   an account and no database — somebody set the account to have the console opened, and it cannot be: there is no
//                                Supabase address or public key to sign in with. Saying NOT CHECKED and passing there is a
//                                gate that checks nothing in silence, which is the failure that file exists to end.
//
// Half an account (an email with no password, or the other way) is the second case too: somebody meant it.
// So three answers, never a fourth — "run", "not-checked" (exit 0), "broken" (exit 1) — and the names that are missing,
// never a value. An empty string is not set: GitHub hands a workflow "" for a secret nobody has set. Pure: an environment
// in, an answer out (scripts/r14.test.mjs).
export const ACCOUNT = ["GT3_SMOKE_EMAIL", "GT3_SMOKE_PASSWORD"];
export const DATABASE = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

/** @param {Record<string, string | undefined>} env */
export function smokeGate(env) {
  const set = (k) => typeof env[k] === "string" && env[k].trim() !== "";
  if (!ACCOUNT.some(set)) return { verdict: "not-checked", missing: [...ACCOUNT] };
  const missing = [...ACCOUNT, ...DATABASE].filter((k) => !set(k));
  return missing.length ? { verdict: "broken", missing } : { verdict: "run", missing: [] };
}
