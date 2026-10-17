// WHAT KIND OF NO A READ OR A WRITE GOT (R13, 2026-10-16 — the 10/10 audit's operations pass, F17).
//
// A screen's read that failed said so on the screen (lib/useAsyncData, R7b's "couldn't load") — and nowhere else. The
// failures that are bugs — a column a deploy expected and the database does not have yet, a grant or a row rule that
// refuses the crew, a view that went — looked exactly like a phone with no signal, and the app's error report heard of
// none of them. This sorts an answer into the kind it is, so the one kind that is ours to fix is reported
// (lib/failureReport) and the rest are only said on the screen:
//   · network    — the request did not get an answer: no signal, a timeout, a dropped connection. Not a bug.
//   · refusal    — the database's own rules said no in words meant for a person (a raise, a check, a duplicate, input
//                  that is not a number). The screen says it; nothing is wrong with the app.
//   · schema     — the app asked for a column, table, view or function the database does not have.
//   · permission — a grant or a row rule refused it.
//   · session    — the sign-in's token had run out when the request went (a phone woken from sleep asks before the
//                  client has refreshed it): the next ask carries a fresh one. Not a bug (R18).
//   · other      — anything else the server answered with: a bug until shown otherwise.
// The database that can't be reached at all (PostgREST's PGRST000–PGRST002: no connection, its schema cache still loading)
// is the network's, as no signal is — the outage is said by the uptime check, not by every phone that noticed (R18).
// Pure.

export type FailureClass = "network" | "refusal" | "session" | "schema" | "permission" | "other";

type Answer = { code?: string | null; message?: string | null; status?: number | null } | string | null | undefined;

const NETWORK = /fetch failed|failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout|aborted|aborterror|the internet connection|connection (?:was )?(?:lost|reset|closed|refused)|offline/i;
const SCHEMA_CODES = new Set(["42703", "42P01", "42883", "42704", "PGRST200", "PGRST201", "PGRST202", "PGRST203", "PGRST204", "PGRST205"]);
const PERMISSION_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

export function failureClass(e: Answer): FailureClass {
  if (e == null) return "other";
  const code = typeof e === "string" ? "" : String(e.code ?? "");
  const message = typeof e === "string" ? e : String(e.message ?? "");
  // The database's words for a person first — a raise (P0001), the integrity rules (23…), bad input (22…), a lock it gave
  // up on — whatever they say ("That stop doesn't exist" is a refusal, not a missing table).
  if (code === "P0001" || /^2[23]/.test(code) || code === "55P03" || code === "40001") return "refusal";
  if (code === "PGRST303" || /\bJWT expired\b/i.test(message)) return "session";
  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") return "network";
  if (SCHEMA_CODES.has(code)) return "schema";
  if (PERMISSION_CODES.has(code)) return "permission";
  if (!code && NETWORK.test(message)) return "network";
  if (/column .+ does not exist|relation .+ does not exist|function .+ does not exist|could not find the .+ in the schema cache/i.test(message)) return "schema";
  if (/permission denied|row-level security/i.test(message)) return "permission";
  if (NETWORK.test(message) || (typeof e !== "string" && e.status === 0)) return "network";
  return "other";
}

/** Whether the app's error report should hear of it — ours to fix, not the network's, not a person's refusal — and as
 *  what. An "other" is reported only when the database or the server named it with a code: a loader's own sentence
 *  ("Couldn't load the plan") does not say which kind it was, and a phone at a festival with no signal is not a bug. */
export function reportable(e: Answer): FailureClass | null {
  const c = failureClass(e);
  if (c === "schema" || c === "permission") return c;
  if (c === "other" && e != null && typeof e !== "string" && String(e.code ?? "") !== "") return c;
  return null;
}
