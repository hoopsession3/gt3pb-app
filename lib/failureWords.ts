import { refusalText, ROW_SECURITY } from "./refusal";

// PLAIN WORDS FOR A FAILURE (R34, 2026-10-18 — the fresh audit's UX11-11). Two hundred places said a failure in the
// database's or the network's own words — "Error: new row violates row-level security policy for table "events"", "Couldn't
// save — JWT expired", "Failed to fetch" — to a crew member or a customer who could do nothing with them. A failure is said
// in one of a few plain sentences now, each with what to do next; the raw text is the error report's (lib/failureReport),
// never the person's. What the database itself says in plain words — a value it won't take, a change it refuses, a row that
// is gone (lib/refusal) — and a sentence one of our own routes wrote are said as they are.

type Err = { code?: string | number | null; message?: string | null; status?: number | null } | string | null | undefined;

const SIGNED_OUT = /JWT expired|invalid JWT|jwt (is )?malformed|Auth session missing|not authenticated|PGRST301/i;
// The phone's signal, in each engine's words for it (Chrome, Firefox, Safari, Node's fetch, an abort or a deadline) — and
// never one of our own sentences: "Square took too long to answer — nothing was charged" is said as it is.
const NO_SIGNAL = /Failed to fetch|NetworkError|network request failed|Load failed|fetch failed|The Internet connection appears to be offline|The network connection was lost|signal timed out|The operation timed out|AbortError|TimeoutError|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i;
// What isn't a sentence for a person: the database's, the server's and the code's own vocabulary. Named things the way
// Postgres quotes them (relation "events", column "totl_cents"), its error classes, PostgREST's codes and cache, the
// engines' error kinds, HTTP's status lines — and markup or a snake_case call. "The Daily Stack" and "a table for four" are
// ours; `relation "x"` and `function public.x(uuid)` are not.
const MACHINE = /[{}<>]|\b(relation|column|table|function|type|schema|operator|constraint|index) "|\bfunction [\w.]+\(|\w+_\w+\(|\bdoes not exist\b|syntax error|invalid input syntax|\bviolates\b|\bconstraint\b|null value in|duplicate key|permission denied|value too long|out of range for|numeric field overflow|canceling statement|statement timeout|lock timeout|deadlock detected|could not serialize|schema cache|PGRST\d|SQLSTATE|\bundefined\b|\bNaN\b|TypeError|SyntaxError|ReferenceError|RangeError|\bJSON\b|Unexpected (token|end)|status code \d{3}|\bHTTP \d{3}\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|at [\w.$]+ \(/;
const GENERIC = "try again in a moment";
const sentence = (plain: string) => { const s = plain.charAt(0).toUpperCase() + plain.slice(1); return /[.!?]$/.test(s) ? s : `${s}.`; };

/** Whether these words carry the machine's vocabulary — a raw failure, not a sentence for a person. Pure. */
export function machineWords(text: string): boolean {
  return ROW_SECURITY.test(text) || SIGNED_OUT.test(text) || NO_SIGNAL.test(text) || MACHINE.test(text);
}

/** The failure, in plain words, lower-case first — to follow "Couldn't save — ". Pure. */
export function plainFailure(e: Err): string {
  if (!e) return GENERIC;
  const msg = (typeof e === "string" ? e : String(e.message ?? "")).trim();
  const code = typeof e === "string" ? "" : String(e.code ?? "");
  if (ROW_SECURITY.test(msg)) return "that isn't yours to change — an owner or admin can";
  const said = typeof e === "string" ? null : refusalText({ code, message: e.message });
  if (said) return said;
  if (SIGNED_OUT.test(msg) || code === "PGRST301") return "your sign-in ran out — sign in again, then try once more";
  if (NO_SIGNAL.test(msg)) return "no signal just now — try again in a moment";
  if (code === "23505" || /duplicate key/i.test(msg)) return "that's already there";
  if (code === "23503") return "it's still in use somewhere else";
  if (code === "23514") return "that value isn't allowed here";
  if (code === "PGRST116") return "that isn't there any more";
  if (msg && msg.length <= 200 && !MACHINE.test(msg)) return msg.replace(/^Error:\s*/i, "");   // a sentence one of our routes or the database wrote
  return GENERIC;
}

/** What the person is told: "<lead> — <the failure in plain words>", or the plain words alone as a sentence. Pure. */
export function failureWords(e: Err, lead?: string): string {
  const plain = plainFailure(e);
  return lead ? `${lead} — ${plain}` : sentence(plain);
}

/** The failure's own plain words when it has any (a refusal, the signal, a lapsed sign-in, a route's sentence) — else the
 *  screen's own sentence for it, in place of "Try again in a moment". Pure. */
export function failureOr(e: Err, fallback: string): string {
  const plain = plainFailure(e);
  return plain === GENERIC ? fallback : sentence(plain);
}

/** THE TOAST'S DOOR (components/AppProvider): every error toast passes here on its way to the screen and the screen reader.
 *  Our words are kept; where the machine's follow them ("Couldn't save — JWT expired"), the machine's are put in plain
 *  ones; a toast that is the machine's alone is said as a failure. A screen that forgot — or a helper's raw text that
 *  reached a toast — is caught here. Pure. */
export function sayable(text: string): string {
  const t = String(text ?? "").trim().replace(/^Error:\s*/i, "");
  if (!t || !machineWords(t)) return t;
  const parts = t.split(" — ");
  for (let i = parts.length - 1; i >= 1; i--) {
    const lead = parts.slice(0, i).join(" — ");
    if (!machineWords(lead)) return `${lead} — ${plainFailure(parts.slice(i).join(" — "))}`;
  }
  return failureWords(t);
}

// A SIGN-IN'S REFUSAL, IN PLAIN WORDS (R34 — UX11-11). Supabase Auth's own sentences ("Email rate limit exceeded", "Token
// has expired or is invalid", "Password should be at least 6 characters") reached the sign-in screen as they came.
const AUTH: [RegExp, string][] = [
  [/rate limit|too many requests|you can only request this/i, "Too many tries just now — wait a minute, then try again."],
  [/Invalid login credentials/i, "Wrong email or password."],
  [/Email not confirmed/i, "Confirm your email first — the link is in your inbox."],
  [/already (been )?registered|already exists/i, "That email already has an account — sign in instead."],
  [/Password should|weak password|password is too weak|pwned/i, "Choose a stronger password — longer, and not a common one."],
  [/expired|invalid (otp|token)|otp_expired|Token has expired/i, "That code didn't work or has run out — ask for a new one."],
  [/Signups not allowed|signup(s)? (is |are )?disabled/i, "New accounts are paused just now."],
  [/Unable to validate email|invalid email|email address .* is invalid/i, "That email address doesn't look right."],
];

/** What a person is told when signing in, up or back fails. Pure. */
export function authWords(e: Err): string {
  const msg = (typeof e === "string" ? e : String(e?.message ?? "")).trim();
  for (const [re, words] of AUTH) if (re.test(msg)) return words;
  return failureWords(e);
}
