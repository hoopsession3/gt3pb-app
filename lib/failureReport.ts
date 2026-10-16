import { reportable } from "./failureClass";

// THE ONE PLACE A FAILED READ OR WRITE IS REPORTED FROM (R13, 2026-10-16 — the 10/10 audit's operations pass, F17).
// lib/useAsyncData, every screen's read, and lib/wrote, every write's answer, hand their failures here; lib/failureClass
// decides which are ours to fix, and those go to the app's error report (components/ErrorReporter installs the sender
// when the app starts — this module imports nothing of the browser's, so the tests load it as it is). One report per
// kind of failure per page load, at most MAX_PER_LOAD: a screen that fails on every realtime change reports once.

export const MAX_PER_LOAD = 6;
type Send = (message: string) => void;
let send: Send | null = null;
const seen = new Set<string>();

/** components/ErrorReporter, once, as the app starts. */
export function setFailureSender(fn: Send | null): void {
  send = fn;
}

type Failure = { code?: string | null; message?: string | null; status?: number | null } | string | null | undefined;

/** Report a failure if it is one of ours: `doing` is "load" or "save", `what` names the thing where the caller can. */
export function reportFailure(doing: "load" | "save", failure: Failure, what?: string): void {
  try {
    const kind = reportable(failure);
    if (!kind || !send || seen.size >= MAX_PER_LOAD) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const code = typeof failure === "object" && failure ? String(failure.code ?? "") : "";
    const words = (typeof failure === "string" ? failure : String(failure?.message ?? "")).replace(/\s+/g, " ").trim().slice(0, 200);
    const message = `[${doing}${what ? `: ${what}` : ""}] ${kind}${code ? ` ${code}` : ""} — ${words || "no message"}`;
    if (seen.has(message)) return;
    seen.add(message);
    send(message);
  } catch { /* reporting never makes a failure worse */ }
}
