import { reportable } from "./failureClass";

// THE ONE PLACE A FAILED READ OR WRITE IS REPORTED FROM (R13, 2026-10-16 — the 10/10 audit's operations pass, F17).
// lib/useAsyncData, every screen's read, and lib/wrote, every write's answer, hand their failures here; lib/failureClass
// decides which are ours to fix, and those go to the app's error report (components/ErrorReporter installs the sender
// when the app starts — this module imports nothing of the browser's, so the tests load it as it is). One report per
// kind of failure per page load, at most MAX_PER_LOAD: a screen that fails on every realtime change reports once.
//
// AND AT THE DATABASE'S DOOR (R18, 2026-10-17 — the 10/10 audit, operations F17). Those two were the only callers, and most
// of the app's reads went neither way: the 26 through lib/useLatestRead, every inline `await supabase.from(…)`, every call
// of a database function — a missing column or a refused grant there was a quiet empty screen, reported by nobody. The
// browser's client (lib/supabase) now hands every answer the database refused to reportFailingAnswers below, as it arrives,
// whoever asked and whatever they do with it. A failure the screen's own reader reports too is the same report — one per
// kind, code and words a page load, whichever door said it first.

export const MAX_PER_LOAD = 6;
type Send = (message: string) => void;
let send: Send | null = null;
const seen = new Set<string>();

/** components/ErrorReporter, once, as the app starts. */
export function setFailureSender(fn: Send | null): void {
  send = fn;
}

type Failure = { code?: string | null; message?: string | null; status?: number | null } | string | null | undefined;

// What the door says besides a schema or a permission failure (R18 review): an answer the server itself failed (5xx), and
// the codes that are always a bug in a rule or a function of ours — ambiguous or mistyped SQL and the rest of class 42
// (42501 and the missing-thing codes are said above), more rows than one where one was meant (21000), a deadlock (40P01),
// a feature not there (0A000), Postgres's internal error (XX…). A function's own refusal never reaches here (failureClass).
const ALWAYS_OURS = /^(42|21|0A|XX)|^40P01$/;
function atTheDoorAnyway(failure: Failure): boolean {
  if (typeof failure !== "object" || !failure) return false;
  return Number(failure.status) >= 500 || ALWAYS_OURS.test(String(failure.code ?? ""));
}

/** Report a failure if it is one of ours: `doing` is "load", "save" or "call" (a database function), `what` names the
 *  thing where the caller can. `atTheDoor` is reportFailingAnswers below: it hears every answer the database refused,
 *  including the ones a screen asked for knowing they may fail and says itself, so it reports the kinds that are never a
 *  person's — a missing column, table or function, a grant or a row rule that refused, and a coded answer that is always a
 *  bug (ALWAYS_OURS, or the server's own 5xx) (R18 review). A screen's own reader (lib/useAsyncData, lib/wrote) reports any
 *  coded "other". */
export function reportFailure(doing: "load" | "save" | "call", failure: Failure, what?: string, atTheDoor = false): void {
  try {
    const kind = reportable(failure);
    if (!kind || !send || seen.size >= MAX_PER_LOAD) return;
    if (atTheDoor && kind !== "schema" && kind !== "permission" && !(kind === "other" && atTheDoorAnyway(failure))) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const code = typeof failure === "object" && failure ? String(failure.code ?? "") : "";
    const words = (typeof failure === "string" ? failure : String(failure?.message ?? "")).replace(/\s+/g, " ").trim().slice(0, 200);
    // Once per kind, code and words — not per sentence: the door below and the screen's own reader say the same failure.
    const once = `${kind}|${code}|${words}`;
    if (seen.has(once)) return;
    seen.add(once);
    send(`[${doing}${what ? `: ${what}` : ""}] ${kind}${code ? ` ${code}` : ""} — ${words || "no message"}`);
  } catch { /* reporting never makes a failure worse */ }
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The browser's door to the database (lib/supabase wraps its fetch in this): every answer PostgREST refused is handed to
 *  reportFailure as it arrives — what was being done (a read, a write, a function), the table or the function by name,
 *  the database's code and words; never a value or a filter — and said only when it is a schema or a permission
 *  failure. Only an answer that is not ok is read, from a copy (the caller reads its own); auth and storage answers are
 *  their own doors' to say. "No such row" for .single() (PGRST116) is the caller's to judge — a code typed wrong is not
 *  a bug — so it is not said here. Never throws, never waits. */
export function reportFailingAnswers(fetchFn: Fetch): Fetch {
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (!res.ok) {
      try {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const door = /\/rest\/v1\/(rpc\/)?([\w-]+)/.exec(href);
        const method = String(init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
        if (door) res.clone().json().then((b: { code?: string; message?: string } | null) => {
          if (b?.code === "PGRST116") return;
          reportFailure(door[1] ? "call" : method === "GET" || method === "HEAD" ? "load" : "save", { code: b?.code, message: b?.message, status: res.status }, door[1] ? `${door[2]}()` : door[2], true);
        }, () => { /* not the database's words */ });
      } catch { /* reporting never makes a failure worse */ }
    }
    return res;
  };
}
