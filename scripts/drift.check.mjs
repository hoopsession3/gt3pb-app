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
const LEDGER_FLOOR = 304;

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
