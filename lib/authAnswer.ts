// WHAT AN AUTH ANSWER MEANS (R15, 2026-10-17 — the 10/10 audit, API F13). lib/apiAuth's callerFromRequest asks the auth
// service whose a bearer token is; this says whether a failed answer is the service failing or a token it refused.

/** The service failing rather than refusing: the network (status 0), a 5xx, or an answer it could not read. A 4xx is a
 *  refusal — an expired or forged token is a guest, as it always was. Pure (scripts/r15.test.mjs). */
export function authUnavailable(error: { status?: unknown; name?: unknown } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError") return true;
  const status = typeof error.status === "number" ? error.status : 0;
  return status === 0 || status >= 500;
}
