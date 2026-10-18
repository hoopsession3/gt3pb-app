// A REFUSAL IS A SENTENCE, AND A 4xx (2026-10-08, 0360).
//
// The database says no in plain words: "The minimum is 3 gallons." "Changes to this delivery closed
// Sunday at 6:00 PM." "That delivery no longer exists." Each one comes back with a code that says
// what kind of no it is, and a screen reads the code to decide what to do next: show the words, turn
// the change sheet into a request, or close it because the delivery is gone. The office screens
// read those codes in four places, each with its own copy of the list. They are read here now.
//
// 0360 moved two of the codes. PostgREST answered 55000 and P0002 with HTTP 500, a server error, so
// every late change and every stale tap was logged as the server failing. They are PT409 and
// PT404 now, which PostgREST answers with 409 and 404 (0226 did the same for the vendor look-alike).
// Until 0360 is pasted, the database still sends the old two, so both are read here and the paste
// and the deploy can go in either order. Once every database is past 0360 the old two can go.
//
// The words are the database's own. A failure that is not a refusal (the network, a server that
// fell over) has no words worth showing, so the screen says "try again" instead.

type DbError = { code?: string | null; message?: string | null } | null | undefined;

const code = (e: DbError) => String(e?.code ?? "");

// POSTGRES'S OWN "NO" SHARES OUR CODE (R34 — the fresh audit's UX11-11). 42501 is the code our functions raise with a
// sentence ("Only an owner or admin can …"), and the code Postgres answers with in its own words: "new row violates
// row-level security policy for table "events"", "permission denied for table orders". Those are the table's name, not a
// sentence — said as what they mean for the person.
export const ROW_SECURITY = /row-level security|permission denied for|violates row-level/i;
export const NOT_YOURS = "That isn't yours to change — an owner or admin can.";

/** The delivery's state refuses the change: closed, under way, paid, paused, the morning taken. */
export function isClosed(e: DbError): boolean {
  const c = code(e);
  return c === "PT409" || c === "55000";
}

/** Not there for this person: taken off, a stale tap, or another company's (said the same way). */
export function isGone(e: DbError): boolean {
  const c = code(e);
  return c === "PT404" || c === "P0002";
}

/**
 * The database's words, when the error is a refusal a person can act on: a value it will not take
 * (22023), something this person may not do (42501, 28000), or one of the two above. Null for a
 * failure, so the caller shows its own "try again".
 */
export function refusalText(e: DbError): string | null {
  const msg = String(e?.message ?? "").trim();
  if (!msg) return null;
  const c = code(e);
  if ((c === "42501" || c === "28000") && ROW_SECURITY.test(msg)) return NOT_YOURS;
  return c === "22023" || c === "42501" || c === "28000" || isClosed(e) || isGone(e) ? msg : null;
}
