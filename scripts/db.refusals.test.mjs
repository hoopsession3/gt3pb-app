// EVERY REFUSAL IS A 4xx (2026-10-08, 0360). Against the whole schema (every migration, in order:
// scripts/fixtures/schema.full.mjs).
//
// The browser calls the database through PostgREST, and PostgREST turns the SQLSTATE a function
// raises into the HTTP status of the answer. Most refusals land on a 4xx: a plain RAISE (P0001) and a
// bad value (22023) are 400, "you may not" (42501, 28*) is 401 or 403, and 'PTxyz' is exactly xyz.
// Some codes land on 500, the status for a server that failed. 0357 and 0359 used two of those,
// 55000 and P0002, for "changes closed" and "that delivery isn't there", so every late change and every
// stale tap was logged as a server error. 0226 had already ruled this out for the vendor look-alike
// ("PT409 … never a 5xx"); nothing held the next function to it. This does:
//
//   1. The table below is PostgREST's (docs → Errors → "SQLSTATE → HTTP status"); its rows are checked.
//   2. Every function in public — the API's schema — is read as the database holds it after the last
//      migration (pg_proc, not the migration text, so a later CREATE OR REPLACE is what is judged).
//      Every code it raises on purpose, written as a code or a condition name, is mapped to its
//      status, and a 5xx is a finding. So is ASSERT (P0004) and SELECT … INTO STRICT (P0002/P0003),
//      which raise one on their own.
//   3. A function that has to answer 5xx on purpose (a real outage, said as one) goes in EXEMPT with
//      its reason. None does today.
//
// NOT CHECKED here: PostgREST itself (none runs in this sandbox) — the mapping is its documented one,
// and the office tests (db.officechange, db.officerun) hold each refusal to its code.
import { fullSchema } from "./fixtures/schema.full.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

/** PostgREST's answer for a SQLSTATE. 42501 is 401 for an anonymous caller; 403 is the signed-in case. */
export function postgrestStatus(sqlstate) {
  const c = String(sqlstate).toUpperCase();
  if (/^PT\d{3}$/.test(c)) return Number(c.slice(2));
  if (c.startsWith("08")) return 503;
  if (c.startsWith("09")) return 500;
  if (c.startsWith("0L") || c.startsWith("0P")) return 403;
  if (c === "23503" || c === "23505") return 409;
  if (c === "25006") return 405;
  if (c.startsWith("25")) return 500;
  if (c.startsWith("28")) return 403;
  if (["2D", "38", "39", "3B", "40"].some((p) => c.startsWith(p))) return 500;
  if (c === "53400") return 500;
  if (c.startsWith("53")) return 503;
  if (["54", "55", "57", "58", "F0", "HV", "XX"].some((p) => c.startsWith(p))) return 500;
  if (c === "P0001") return 400;
  if (c.startsWith("P0")) return 500;
  if (c === "42883" || c === "42P01") return 404;
  if (c === "42P17") return 500;
  if (c === "42501") return 403;
  return 400;
}

// Condition names a function may raise by name (RAISE no_data_found, or USING ERRCODE =
// 'unique_violation'), to their codes. A name not here is a finding until it is added: the gate
// never guesses a status.
const CONDITIONS = {
  raise_exception: "P0001", no_data_found: "P0002", too_many_rows: "P0003", assert_failure: "P0004",
  invalid_parameter_value: "22023", check_violation: "23514", not_null_violation: "23502",
  unique_violation: "23505", foreign_key_violation: "23503", insufficient_privilege: "42501",
  invalid_authorization_specification: "28000", object_not_in_prerequisite_state: "55000",
  lock_not_available: "55P03", internal_error: "XX000", data_exception: "22000",
  invalid_text_representation: "22P02", serialization_failure: "40001", query_canceled: "57014",
};

// A function that must answer 5xx on purpose, with the reason. Empty: none does.
const EXEMPT = {};

// ── 1 · the table, row by row ───────────────────────────────────────────────────────────────────
for (const [code, want] of [["P0002", 500], ["55000", 500], ["P0001", 400], ["22023", 400], ["42501", 403], ["28000", 403],
  ["23505", 409], ["23503", 409], ["PT409", 409], ["PT404", 404], ["40001", 500], ["XX000", 500], ["53300", 503], ["P0004", 500]]) {
  ok(`postgrest: ${code} → ${want}`, postgrestStatus(code) === want, postgrestStatus(code));
}

// ── 2 · every function in public, as the database holds it ──────────────────────────────────────
// Comments go first, so a raise written in a comment is not read. Then, for the statements, string
// literals are emptied, so "could not raise the price" inside a message is not read as a raise;
// the codes themselves are literals, so they are read before that.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const blankStrings = (src) => src.replace(/'(?:[^']|'')*'/g, "''");
const LEVELS = new Set(["debug", "log", "info", "notice", "warning", "exception", "using", "sqlstate"]);

/** The codes a function body raises on purpose, with how each was written. */
export function raisedCodes(src) {
  const s = stripComments(src);
  const bare = blankStrings(s);
  const out = [];
  for (const m of s.matchAll(/errcode\s*=\s*'([^']+)'/gi)) out.push({ how: `errcode '${m[1]}'`, code: m[1] });
  for (const m of s.matchAll(/\braise\s+(?:exception\s+)?sqlstate\s+'([^']+)'/gi)) out.push({ how: `raise sqlstate '${m[1]}'`, code: m[1] });
  for (const m of bare.matchAll(/\braise\s+(?:exception\s+)?([a-z_][a-z0-9_]*)/gi)) {
    if (LEVELS.has(m[1].toLowerCase())) continue;
    out.push({ how: `raise ${m[1]}`, code: m[1] });
  }
  if (/(^|;|\bthen|\bloop|\bbegin)\s*assert\b/im.test(bare)) out.push({ how: "assert", code: "P0004" });
  if (/\binto\s+strict\b/i.test(bare)) out.push({ how: "into strict", code: "P0002" });
  return out.map((r) => {
    const c = /^[0-9A-Z]{5}$/i.test(r.code) && !(r.code.toLowerCase() in CONDITIONS) ? r.code.toUpperCase() : CONDITIONS[r.code.toLowerCase()] ?? null;
    return { ...r, sqlstate: c, status: c ? postgrestStatus(c) : null };
  });
}

// The reader, on the shapes it has to tell apart.
{
  const r = raisedCodes(`begin
    -- raise exception 'old' using errcode = '55000';   (a comment is not a raise)
    raise exception 'Closed.' using errcode = 'PT409';
    raise exception 'Gone.' using errcode = 'P0002';
    raise no_data_found using message = 'x';
    raise exception using errcode = 'unique_violation';
    raise sqlstate '55P03';
    raise notice 'hello';
    raise exception 'plain';
    raise exception 'We could not raise the price — try again.';
    assert v > 0;
    select 1 into strict v;
    raise exception 'odd' using errcode = 'made_up_name';
  end`);
  const got = r.map((x) => `${x.sqlstate ?? "?"}:${x.status ?? "?"}`).join(" ");
  ok("reader: codes, names, sqlstate, assert, into strict; comments and notices skipped; an unknown name unresolved",
    got === "PT409:409 P0002:500 23505:409 ?:? 55P03:500 P0002:500 P0004:500 P0002:500", got);
}

const db = await fullSchema();
const fns = (await db.query(
  `select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname = 'plpgsql' order by 1, 2`)).rows;
ok("the schema loaded with its functions", fns.length > 100, fns.length);

const findings = [], unknown = [];
let raises = 0;
for (const f of fns) {
  for (const r of raisedCodes(f.prosrc)) {
    raises++;
    const name = `${f.proname}(${f.args})`;
    if (r.sqlstate === null) { unknown.push(`${name}: ${r.how}`); continue; }
    if (r.status >= 500 && !EXEMPT[f.proname]) findings.push(`${name}: ${r.how} → HTTP ${r.status}`);
  }
}
ok(`every condition name raised is in the table (${raises} raises read)`, unknown.length === 0, unknown);
ok("no function raises a code PostgREST answers with a 5xx — a refusal is a 4xx (0226's PT409, 0360)", findings.length === 0, findings);
for (const [fn, why] of Object.entries(EXEMPT)) ok(`exempt ${fn} says why`, typeof why === "string" && why.length > 20, why);

// ── 3 · the seven 0360 moved answer with the new codes, in the database itself ────────────────────
{
  const seven = ["office_log_delivery", "office_reopen_delivery", "office_change_delivery", "office_open_dates", "office_request", "office_request_set", "office_home"];
  const codes = Object.fromEntries(seven.map((n) => [n, fns.filter((f) => f.proname === n).flatMap((f) => raisedCodes(f.prosrc).map((r) => r.sqlstate))]));
  ok("0360: the seven office functions raise PT409/PT404 where they raised 55000/P0002: eight ‘closed’ (PT409) and eleven ‘not there’ (PT404)",
    Object.values(codes).flat().filter((c) => c === "PT409").length === 8 && Object.values(codes).flat().filter((c) => c === "PT404").length === 11
      && !Object.values(codes).flat().some((c) => c === "55000" || c === "P0002"), codes);
}

await db.close();
console.log(`db.refusals: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
