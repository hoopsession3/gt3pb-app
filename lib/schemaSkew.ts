// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SCHEMA SKEW — the database is one migration behind the code.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Moved out of lib/deploySkew.ts on 2026-10-04, unchanged. That file decides when a crashed screen
// is a client one BUILD behind, and app/error.tsx loads it on every page; this decides when an error
// is a database one MIGRATION behind, and only the screens and routes that write arriving columns
// load it. Same word, two questions, two homes.
//
// lib/deploySkew is the client being one BUILD behind. This is the mirror image, and in this
// repo it is not a rare race — it is guaranteed by the workflow. Migrations are applied BY HAND in
// the Supabase SQL editor, and the push happens first. So between `git push` and the paste, every
// deploy is running new code against the old schema, and the window is however long it takes
// somebody to open a browser tab.
//
// 2026-10-01 is where this stopped being theoretical. 0337 adds brew_vessels.min_gal and
// BrewPlanner's loader selects it. PostgREST answers an unknown column with 42703, and that loader
// does `[...].find(x => x.error)` then THROWS — so one column that does not exist yet takes down
// the whole Brew board: recipes, batches, events, stops and inventory, none of which have anything
// to do with the new column. Pushing before pasting would have broken a working screen.
//
// WHY A PREDICATE AND NOT A try/catch AT THE CALL SITE. Because a blanket catch would swallow the
// errors that MATTER — a dropped table, a revoked grant, RLS refusing the read — and turn a loud
// failure into an empty list. "A failed read is not an empty list" is the rule this repo keeps
// re-learning; this narrows the forgiveness to exactly one condition, named, and leaves every other
// error as loud as it was.
//
// 42703 is `undefined_column` in the Postgres error-code table, and PostgREST passes it through.
// The message is matched too, because PGlite and some proxies report the text without the code.
const MISSING_COLUMN_TEXT = /column\s+\S*\.?\S+\s+does not exist/i;

// THE WRITE SIDE (2026-10-04). A read names a column in its select and Postgres answers 42703. A
// WRITE names it as a key of the row, and PostgREST refuses before Postgres sees it, with its own
// code: PGRST204, "Could not find the 'ready_from' column of 'orders' in the schema cache". 0343
// adds orders.ready_from and /api/checkout writes it, so between the push and the paste every
// pre-order placed ahead of a stop would have failed — on the paid path AFTER the card was charged.
// Same narrowness as the read side: this one code, or this one sentence, and nothing else.
const MISSING_WRITE_COLUMN_TEXT = /Could not find the '[^']+' column of '[^']+' in the schema cache/i;

/** Is this error ONLY "that column is not there yet" — i.e. the schema is behind this build? */
export function isMissingColumn(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42703" || code === "PGRST204") return true;
  const msg = String(err.message ?? "");
  return MISSING_COLUMN_TEXT.test(msg) || MISSING_WRITE_COLUMN_TEXT.test(msg);
}

/**
 * Write a row; if the database is one migration behind and lacks a column, write it again without
 * the keys the CALLER named as arriving (and only those — a fallback that dropped whatever the
 * error complained about would drop a typo too). Any other error comes back exactly as it was.
 */
export async function writeAcrossSkew<R extends Record<string, unknown>, E extends { code?: string | null; message?: string | null }>(
  write: (row: R) => PromiseLike<{ error: E | null }>, row: R, arriving: readonly string[],
): Promise<{ error: E | null; dropped: string[] }> {
  const first = await write(row);
  const present = arriving.filter((k) => k in row);
  if (!first.error || !isMissingColumn(first.error) || present.length === 0) return { error: first.error, dropped: [] };
  const rest = { ...row };
  for (const k of present) delete rest[k];
  const second = await write(rest);
  return { error: second.error, dropped: second.error ? [] : present };
}

// THE FUNCTION THAT DOES NOT EXIST YET (2026-10-05). The same window, for an RPC: a push that calls a
// function in the shape a pending migration gives it (0347 adds receive_lot's p_vendor_id) reaches
// PostgREST before the paste, and PostgREST answers PGRST202, "Could not find the function
// public.receive_lot(...) in the schema cache". Same narrowness as above: this one code, or this one
// sentence. A caller that sees it says the step arrives with the next database update — it never
// falls back to an older shape that would do something different.
const MISSING_FUNCTION_TEXT = /Could not find the function [^\s(]+\(/i;

/** Is this error ONLY "that function (in this shape) is not there yet"? */
export function isMissingFunction(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (String(err.code ?? "") === "PGRST202") return true;
  return MISSING_FUNCTION_TEXT.test(String(err.message ?? ""));
}
