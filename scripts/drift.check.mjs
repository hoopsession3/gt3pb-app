// NO-DRIFT GATE (0269 — Ryan: "I don't want no drift anywhere again.")
//
// The failure mode this kills: the app shipped ~20 rounds while its own changelog — the
// institutional memory a cofounder reads — sat frozen at 2026-07-16. Nobody decided that;
// it drifted. Drift survives on being invisible, so this check makes it LOUD: every migration
// from 0269 forward must state its changelog position, in the file itself, or the release
// gate fails before the round can leave the shop.
//
// The contract (checked mechanically, satisfied one of two ways):
//   1. The migration carries its own entries:        insert into public.changelog ...
//   2. An explicit, greppable declaration:           -- changelog: <where the entry lives, or
//      why none is needed>  (e.g. "-- changelog: covered by 0271_big_round.sql" for split
//      rounds, or "-- changelog: none — data backfill, nothing user-visible")
//
// Opting out is allowed; drifting silently is not. The declaration is one comment line —
// friction stays near zero, which is what keeps a rule like this alive.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");
const FLOOR = 269;   // the rule starts where it was written — history isn't retro-judged

// ── SECOND RULE, added at 0304: every migration must record that it ran ────────────────────────
// The changelog rule above keeps the STORY of a change from drifting. This one keeps the FACT of it
// from drifting. Nothing in the database recorded which files had been applied, so "what is still
// pending" could only ever be answered from someone's memory of this directory — and on 2026-09-06
// that produced a confident "28 migrations pending" for a database where all 28 had already run.
// 0304 added a ledger; a ledger is only worth having if it cannot fall behind, so every migration
// from 0304 forward ends with one line:
//
//   select public.record_migration('0304_migrations_ledger');
//
// The argument must be the file's own name without .sql, because two pairs of files share a number
// (0007 and 0040) and a ledger keyed on the number silently drops one of each pair.
const RLS_FLOOR = 310;   // the rule starts where it was written — history isn't retro-judged
const LEDGER_FLOOR = 304;
const VIEW_FLOOR = 312;  // the fourth rule, below

const offenders = [];
const unstamped = [];
const misstamped = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const n = parseInt(f.slice(0, 4), 10);
  if (!Number.isFinite(n)) continue;
  const sql = readFileSync(join(DIR, f), "utf8");

  if (n >= FLOOR) {
    const hasEntry = /insert\s+into\s+public\.changelog/i.test(sql);
    const hasDeclaration = /^\s*--\s*changelog:/im.test(sql);
    if (!hasEntry && !hasDeclaration) offenders.push(f);
  }

  if (n >= LEDGER_FLOOR) {
    // Ignore the line in a comment — a migration that only TALKS about stamping has not stamped.
    const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const call = live.match(/record_migration\s*\(\s*'([^']+)'/i);
    if (!call) { unstamped.push(f); continue; }
    const expected = f.replace(/\.sql$/, "");
    if (call[1] !== expected) misstamped.push(`${f} stamps itself as '${call[1]}' — expected '${expected}'`);
  }
}

// ── THIRD RULE, added after 0309: no table ships without RLS ──────────────────────────────────
// Verifying 0309 in production turned up the fact everything else in this database rests on:
// Supabase's default privileges grant anon full SELECT/INSERT/UPDATE/DELETE on every table in
// public. All 143 tables currently have RLS enabled, so nothing is actually exposed — RLS is the
// ONLY thing standing between an anonymous request and the whole database.
//
// Which means a single `create table` that forgets `enable row level security` is not a small
// oversight. It is a table anybody on the internet can read and write. That is too sharp an edge
// to leave to remembering, so it is checked here: every table a migration creates must enable RLS
// in the same file.
const rlsMissing = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const seq = Number(f.slice(0, 4));
  if (!Number.isFinite(seq) || seq < RLS_FLOOR) continue;
  const sql = readFileSync(join(DIR, f), "utf8");
  const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const created = [...live.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)]
    .map((m) => m[1].toLowerCase());
  if (!created.length) continue;
  const enabled = new Set(
    [...live.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)]
      .map((m) => m[1].toLowerCase()));
  for (const t of new Set(created)) if (!enabled.has(t)) rlsMissing.push(`${f} creates public.${t} without enabling RLS`);
}

// ── FOURTH RULE, added at 0312: a view must not walk around the RLS on its own tables ─────────
// The third rule above put RLS on every table. This one stops a view from making that pointless.
//
// A Postgres view runs as its OWNER unless it is declared `with (security_invoker = on)`. The owner
// here is postgres, which bypasses RLS. So `grant select ... to authenticated` on a definer view
// hands every logged-in customer the unfiltered table. Measured in production before 0312: a real
// member account read ONE row from public.profiles and THREE from public.v_crew_person — the same
// data, one door locked and the one beside it standing open. Thirty-five of forty views were built
// that way, eleven of them by me in the four migrations before this rule existed. Copying the file
// above you is how a defect becomes a house style, which is the entire argument for a gate.
//
// Satisfied any of three ways, in the same file as the create:
//   1. with (security_invoker = on)          — the view honours its base tables' RLS
//   2. alter view ... set (security_invoker = on)
//   3. revoke ... from ... authenticated     — deliberately not readable by the app at all
//   4. -- security_invoker: <view> — <why not>   (the escape hatch, e.g. market_live in 0285,
//      definer on purpose because the storefront asks it while logged out)
const viewOffenders = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const seq = Number(f.slice(0, 4));
  if (!Number.isFinite(seq) || seq < VIEW_FLOOR) continue;
  const sql = readFileSync(join(DIR, f), "utf8");
  const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const created = [...live.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)\s*(?:with\s*\(([^)]*)\))?/gi)];
  for (const m of created) {
    const name = m[1].toLowerCase();
    const inlineInvoker = /security_invoker\s*=\s*on/i.test(m[2] ?? "");
    const alterInvoker = new RegExp(`alter\\s+view\\s+public\\.${name}\\s+set\\s*\\([^)]*security_invoker\\s*=\\s*on`, "i").test(live);
    // A revoke that names this view and takes authenticated's read away — the "nobody in the app
    // reads this" answer. Matched on the same statement so a revoke of some OTHER view can't cover.
    const revoked = new RegExp(`revoke[^;]*\\bon\\b[^;]*\\bpublic\\.${name}\\b[^;]*\\bauthenticated\\b`, "i").test(live);
    const declared = new RegExp(`^\\s*--\\s*security_invoker:\\s*${name}\\b`, "im").test(sql);
    if (!inlineInvoker && !alterInvoker && !revoked && !declared) {
      viewOffenders.push(`${f} creates public.${name} without security_invoker`);
    }
  }
}

// ── FIFTH RULE, added at 0315: an UPDATE or DELETE says which rows ────────────────────────────
// This one comes from a near-miss rather than a defect, and the near-miss is the interesting part.
//
// Applying 0315's correction, the Supabase SQL editor warned "This query runs an UPDATE without a
// WHERE clause. It may update every row in the target table." The statement DID have a WHERE. What
// it also had was a semicolon inside a string literal — the house voice uses them constantly, 54 of
// this directory's migrations contain one — and the editor's warning heuristic splits on semicolons
// without tracking quotes, so it saw a severed fragment and reported it honestly.
//
// The dangerous part was the next step: to check the warning I wrote a splitter, and I wrote the
// SAME naive one. It agreed with the editor. Two broken parsers agreeing looks exactly like
// confirmation, and what they pointed at was "your SQL is about to rewrite every row".
//
// The real answer came from production, not from parsing: 0284 already contains this shape, and
// public.compliance_rules holds 9 rows with 9 DISTINCT labels. Had that UPDATE lost its WHERE they
// would all read the same. The executor parses correctly; only the warning heuristic does not.
//
// So what this leaves behind is not "avoid semicolons in prose" — it is that the repo now owns a
// quote-aware answer to "which rows does this touch", instead of re-deriving one under pressure.
// Baseline when written: 113 top-level UPDATE/DELETE statements across 313 files, exactly ONE
// without a WHERE (0023's is_admin backfill, which is deliberate).
//
// Statements inside function bodies are dollar-quoted and stay inside their create — they are
// reviewed as part of the function, not as loose DML.
const DML_FLOOR = 315;

/** Split SQL into top-level statements, respecting '' literals and $tag$ bodies. */
function topLevelStatements(sql) {
  const t = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const out = []; let cur = "", inStr = false, dq = null;
  for (let i = 0; i < t.length; i++) {
    if (dq) {
      if (t.startsWith(dq, i)) { cur += dq; i += dq.length - 1; dq = null; continue; }
      cur += t[i]; continue;
    }
    if (!inStr) {
      const m = /^\$[a-zA-Z_]*\$/.exec(t.slice(i));
      if (m) { dq = m[0]; cur += m[0]; i += m[0].length - 1; continue; }
    }
    const c = t[i];
    if (c === "'") {
      if (inStr && t[i + 1] === "'") { cur += "''"; i++; continue; }   // an escaped quote, not the end
      inStr = !inStr; cur += c; continue;
    }
    if (c === ";" && !inStr) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const wideDml = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const seq = Number(f.slice(0, 4));
  if (!Number.isFinite(seq) || seq < DML_FLOOR) continue;
  const sql = readFileSync(join(DIR, f), "utf8");
  const declared = /^\s*--\s*whole-table:/im.test(sql);
  for (const s of topLevelStatements(sql)) {
    if (!/^\s*(update|delete\s+from)\s/i.test(s)) continue;
    if (/\bwhere\b/i.test(s)) continue;
    if (declared) continue;
    wideDml.push(`${f} — ${s.replace(/\s+/g, " ").slice(0, 80)}…`);
  }
}

if (wideDml.length) {
  console.error(`WHOLE-TABLE GATE: ${wideDml.length} statement(s) touch every row with no WHERE:`);
  for (const m of wideDml) console.error(`  ✗ ${m}`);
  console.error(
    `\nAn UPDATE or DELETE with no WHERE rewrites the whole table. That is sometimes exactly right ` +
    `(a backfill), so it is allowed — but it has to be said out loud, in the same file:\n` +
    `    -- whole-table: <which statement, and why every row is the intent>\n` +
    `Checked with a quote-aware parser: a semicolon inside a string literal does NOT end a ` +
    `statement, whatever the SQL editor's warning banner says.`
  );
  process.exit(1);
}

if (viewOffenders.length) {
  console.error(`VIEW GATE: ${viewOffenders.length} view(s) would run as the database owner and bypass RLS:`);
  for (const m of viewOffenders) console.error(`  ✗ ${m}`);
  console.error(
    `\nA view without security_invoker runs as postgres, which ignores row-level security — so ` +
    `granting it to \`authenticated\` hands every logged-in customer the unfiltered table. ` +
    `Before 0312 that was measurable: a member read 1 row from profiles and 3 from v_crew_person.\n` +
    `Fix it one of these ways, in the same migration:\n` +
    `    create or replace view public.<name> with (security_invoker = on) as ...\n` +
    `    revoke all on public.<name> from anon, authenticated;   -- if the app never reads it\n` +
    `    -- security_invoker: <name> — <why it is definer on purpose>\n` +
    `Watch the chain: under invoker the CALLER needs select on every view a view stands on.`
  );
  process.exit(1);
}

if (rlsMissing.length) {
  console.error(`RLS GATE: ${rlsMissing.length} table(s) would ship readable and writable by anyone:`);
  for (const m of rlsMissing) console.error(`  ✗ ${m}`);
  console.error(
    `\nSupabase grants anon full CRUD on every table in public by default, so RLS is the only thing ` +
    `between a new table and the open internet. Add, in the same migration:\n` +
    `    alter table public.<name> enable row level security;\n` +
    `A table with RLS on and no policy is fine — that denies everyone. A table without RLS is not.`
  );
  process.exit(1);
}

if (offenders.length) {
  console.error(`NO-DRIFT GATE: ${offenders.length} migration(s) ship without a changelog position:`);
  for (const f of offenders) console.error(`  ✗ ${f}`);
  console.error(
    `\nEvery migration ≥ ${String(FLOOR).padStart(4, "0")} must either insert its own ` +
    `public.changelog entries or carry an explicit "-- changelog: ..." declaration ` +
    `(where the entry lives, or why none is needed). One comment line. No silent drift.`
  );
  process.exit(1);
}

if (unstamped.length || misstamped.length) {
  console.error(`LEDGER GATE: ${unstamped.length + misstamped.length} migration(s) will not record themselves:`);
  for (const f of unstamped) console.error(`  ✗ ${f} — no record_migration() call`);
  for (const m of misstamped) console.error(`  ✗ ${m}`);
  console.error(
    `\nEvery migration ≥ ${LEDGER_FLOOR} must end with:\n` +
    `    select public.record_migration('<this file's name without .sql>');\n` +
    `Otherwise the database cannot say what has been applied to it, and the next person to ask ` +
    `has to guess from this directory — which is exactly how "28 pending" happened.`
  );
  process.exit(1);
}

console.log("NO-DRIFT GATE: every migration declares its changelog position — clean.");
console.log("LEDGER GATE: every migration from 0304 records itself by its own filename — clean.");
console.log("RLS GATE: every table created from 0310 enables row level security in the same file — clean.");
console.log("VIEW GATE: every view created from 0312 honours RLS, is closed to the app, or says why — clean.");
console.log("WHOLE-TABLE GATE: every UPDATE/DELETE from 0315 names its rows, or declares it means all of them — clean.");
