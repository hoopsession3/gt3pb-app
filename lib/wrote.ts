import { refusalText } from "./refusal";
import { reportFailure } from "./failureReport";

/** A write's answer: supabase-js's {error}, or lib/tasks' {error?: string} — its one write path's. */
type WriteAnswer = { error?: { code?: string | null; message?: string | null } | string | null };
type Toast = (msg: string, variant?: "success" | "error" | "info") => void;

// A WRITE'S ANSWER, READ (R12b — the 10/10 audit, F4). supabase-js answers a failed insert, update, delete or call with
// {error}; it does not throw. So a write that was awaited and dropped succeeded on the screen whatever happened —
// "Location archived" with the truck still live at it, "Deleted" over a refusal, a brief's editor closed on a save that
// never landed. `wrote` reads the answer: on a failure it says so — the database's own words when it refused (lib/refusal),
// else its message — and answers false, so the caller keeps the form open, puts back what it moved, and claims nothing.
export function wrote(res: WriteAnswer, toast: Toast, what: string): boolean {
  const e = res.error;
  if (!e) return true;
  const words = typeof e === "string" ? e : refusalText(e) ?? (e.message?.trim() || "try again in a moment");
  toast(`${what} — ${words}`, "error");
  // …and a failure that is ours to fix — a column or a grant the database does not have — reaches the error report too
  // (R13, F17, lib/failureReport); a refusal in a person's words and a lost signal are only said here.
  reportFailure("save", e, what);
  return false;
}
