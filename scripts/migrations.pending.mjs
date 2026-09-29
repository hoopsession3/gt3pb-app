// WHAT HAS NOT BEEN APPLIED TO PRODUCTION YET.
//
//   npm run migrations:pending            # ask, and report
//   npm run migrations:pending -- --write # ask, report, and regenerate supabase/APPLY_ALL_PENDING.sql
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
// On 2026-09-29 three migrations (0326, 0327, 0328) sat unapplied against production for ten hours
// while the shop panel told the owner that nobody was waiting on his first real customer order.
// Finding that out took opening the Supabase SQL editor and running a select by hand. Nothing in
// this repo could answer "is the database current?" — not because the answer was unknowable, but
// because the two halves of it never met:
//
//   supabase/migrations/*.sql      what SHOULD be applied   (326 files)
//   public.schema_migrations       what IS applied          (326 rows, measured)
//
// 0304 built the ledger so that question would stop being answered from memory. Its gate in
// drift.check.mjs still says so: "the database cannot say what has been applied to it, and the next
// person to ask has to guess from this directory — which is exactly how '28 pending' happened."
// The database can say. Until /api/migrations there was no way to ask it from outside a browser
// tab, so the guessing carried on for another 22 migrations.
//
// This is the ONE home for that comparison. supabase/APPLY_ALL_PENDING.sql is its OUTPUT, not a
// second procedure — a hand-maintained copy of "what is pending" is the thing that rotted to 291
// migrations out of date while claiming in its own first line to be complete.
//
// ── WHY COUNT AND MAX_SEQ ARE ENOUGH, AND WHERE THEY ARE NOT ───────────────────────────────────
// /api/migrations is unauthenticated on purpose (a check that needs a credential is a check that
// gets skipped), so it returns two integers and no names. That is enough for the normal case:
//
//   every file at or below max_seq is accounted for   →  pending is exactly the files above it
//
// It is NOT enough when the counts disagree, which means a migration below the high-water mark was
// skipped. Two integers cannot say WHICH. So this refuses to write anything and prints the query
// that names it, rather than emitting a confident file that is missing the one migration that
// matters. Same refusal scripts/schema.snapshot.mjs makes: NOT CHECKED is a worse state than
// checked, and a much better state than confidently wrong.
//
// ── WHY IT DOES NOT FAIL THE BUILD ─────────────────────────────────────────────────────────────
// This needs the network and a live production deploy, so it can be unavailable for reasons that
// have nothing to do with the repo being wrong. It reports and exits 0. The GATE is the PASTE-FILE
// rule in drift.check.mjs, which is offline, reads only this directory, and cannot be skipped.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");
const OUT = join(ROOT, "supabase", "APPLY_ALL_PENDING.sql");
const APP = process.env.GT3_APP_URL || "https://app.gt3pb.com";

/** Every migration file, in apply order, as `{ file, seq }`. */
export function migrationFiles(dir = DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, seq: Number(file.slice(0, 4)) }))
    .filter((m) => Number.isFinite(m.seq));
}

/**
 * Decide what is pending from the two integers the ledger can give us.
 *
 * Returns one of:
 *   { status: "clean",   pending: [] }              nothing to apply
 *   { status: "pending", pending: [{file, seq}] }   these files, in this order
 *   { status: "gap",     reason }                   the counts disagree — refuse to guess
 *
 * The gap case is the whole reason this returns a status instead of a list. `count` below the
 * number of files at or under `maxSeq` means something in the middle of history never ran, and the
 * files ABOVE maxSeq are then not the whole answer — pasting only those would quietly skip it.
 */
export function pendingFrom(files, count, maxSeq) {
  if (!Number.isFinite(maxSeq)) {
    // An empty ledger against a directory full of migrations is not "everything is pending" — it is
    // far more likely to be the wrong database or a ledger table that never got created.
    return files.length
      ? { status: "gap", reason: `the ledger is empty but this directory holds ${files.length} migration(s) — that is a different database, or record_migration() has never run` }
      : { status: "clean", pending: [] };
  }
  const atOrBelow = files.filter((m) => m.seq <= maxSeq);
  if (atOrBelow.length !== count) {
    const diff = atOrBelow.length - count;
    return {
      status: "gap",
      reason: diff > 0
        ? `the ledger holds ${count} row(s) but ${atOrBelow.length} file(s) sit at or below ${String(maxSeq).padStart(4, "0")} — ${diff} migration(s) below the high-water mark never ran`
        : `the ledger holds ${count} row(s) for only ${atOrBelow.length} file(s) at or below ${String(maxSeq).padStart(4, "0")} — the database has ${-diff} migration(s) this directory does not`,
    };
  }
  const pending = files.filter((m) => m.seq > maxSeq);
  return pending.length ? { status: "pending", pending } : { status: "clean", pending: [] };
}

/**
 * The two integers, from the endpoint or from a person who ran the query themselves.
 *
 * The hand-read path exists because of a real ordering problem: /api/migrations ships IN a
 * migration-bearing round, so the first time this command is ever needed the route is not deployed
 * yet. It is also what you want any time production is unreachable but the SQL editor is open:
 *
 *     select count(*), max(seq) from public.schema_migrations;
 *     npm run migrations:pending -- --count=326 --max-seq=328 --write
 *
 * The numbers are trusted, because a person read them off the database. What is NOT done is letting
 * that fact go unrecorded — `source` rides into the generated header, so a file built from typed
 * integers never looks like one built from a live read.
 */
export async function readLedger(argv, app, doFetch = fetch) {
  const arg = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.slice(name.length + 3)) : undefined;
  };
  const count = arg("count"), maxSeq = arg("max-seq");
  if (Number.isFinite(count) && Number.isFinite(maxSeq)) {
    return { ok: true, count, max_seq: maxSeq, source: "hand-read from the SQL editor" };
  }
  if (Number.isFinite(count) !== Number.isFinite(maxSeq)) {
    throw new Error("--count and --max-seq must be given together — one without the other cannot decide anything");
  }
  const res = await doFetch(`${app}/api/migrations`, { headers: { "cache-control": "no-cache" } });
  const body = await res.json();
  if (!res.ok || !body?.ok) throw new Error(`HTTP ${res.status}`);
  return { ...body, source: `${app}/api/migrations` };
}

/** The header that makes the generated file un-stale-able. drift.check.mjs reads `pending-from`. */
export function pasteHeader(highest, generatedAt, pendingCount, source = "unknown") {
  return [
    "-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see",
    "-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.",
    "--",
    "-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────",
    "-- Regenerate with:  npm run migrations:pending -- --write",
    "--",
    "-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger",
    "-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous",
    "-- hand-maintained version said \"apply all pending migrations\" and stopped at 0035 while this",
    "-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.",
    "--",
    "-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release",
    "-- if supabase/migrations/ ever holds a migration numbered above it.",
    `-- pending-from: ${String(highest).padStart(4, "0")}`,
    `-- generated-at: ${generatedAt}`,
    `-- pending-count: ${pendingCount}`,
    `-- ledger-read-from: ${source}`,
    "",
  ].join("\n");
}

async function main() {
  const write = process.argv.includes("--write");
  const files = migrationFiles();
  const highest = files.reduce((a, m) => Math.max(a, m.seq), 0);

  let ledger;
  try {
    ledger = await readLedger(process.argv, APP);
  } catch (e) {
    // A failed read is not an empty ledger. Say so and change nothing.
    console.log(`MIGRATIONS PENDING: NOT CHECKED — could not read the ledger (${e.message}).`);
    console.log(`  ${files.length} migration file(s) on disk, highest ${String(highest).padStart(4, "0")}.`);
    console.log(`  If ${APP}/api/migrations 404s, production predates that route — deploy first, or`);
    console.log(`  read the two numbers yourself and pass them in:`);
    console.log(`      select count(*), max(seq) from public.schema_migrations;`);
    console.log(`      npm run migrations:pending -- --count=<n> --max-seq=<n> --write`);
    console.log(`  Nothing was written. The offline PASTE-FILE gate in drift.check.mjs still applies.`);
    return;
  }

  const { count, max_seq: maxSeq, source } = ledger;
  const verdict = pendingFrom(files, count, maxSeq);

  console.log(`MIGRATIONS PENDING — ${source}`);
  console.log(`  ledger:    ${count} applied, high-water mark ${String(maxSeq ?? 0).padStart(4, "0")}`);
  console.log(`  directory: ${files.length} file(s), highest ${String(highest).padStart(4, "0")}`);

  if (verdict.status === "gap") {
    console.log(`\n  ✗ REFUSING TO GUESS — ${verdict.reason}.`);
    console.log(`\n  Two integers cannot name which one is missing. Run this in the SQL editor and`);
    console.log(`  compare it against supabase/migrations/ by hand:\n`);
    console.log(`      select version, seq from public.schema_migrations order by seq, version;\n`);
    console.log(`  Nothing was written — a bundle missing the one migration that matters is worse`);
    console.log(`  than no bundle at all.`);
    return;
  }

  if (verdict.status === "clean") {
    console.log(`\n  ✓ production is current — nothing to apply.`);
  } else {
    console.log(`\n  ${verdict.pending.length} migration(s) written but NOT applied:`);
    for (const m of verdict.pending) console.log(`    · ${m.file}`);
  }

  if (!write) {
    console.log(`\n  (run with --write to regenerate supabase/APPLY_ALL_PENDING.sql)`);
    return;
  }

  const body = verdict.pending.length
    ? verdict.pending.map((m) => [
        "-- ============================================================",
        `-- ${m.file}`,
        "-- ============================================================",
        readFileSync(join(DIR, m.file), "utf8").replace(/\s*$/, ""),
        "",
      ].join("\n")).join("\n")
    : [
        "-- Nothing is pending. Every migration in supabase/migrations/ is recorded in the ledger.",
        "-- This file is kept (rather than deleted) so the command that regenerates it stays in one",
        "-- place and the gate in drift.check.mjs has something to read.",
        "",
      ].join("\n");

  writeFileSync(OUT, pasteHeader(highest, new Date().toISOString().slice(0, 10), verdict.pending.length, source) + body);
  console.log(`\n  wrote supabase/APPLY_ALL_PENDING.sql — pending-from ${String(highest).padStart(4, "0")}, ${verdict.pending.length} migration(s) inside.`);
}

// Only run when invoked directly, so the pure functions above can be imported by a test.
if (process.argv[1] && process.argv[1].endsWith("migrations.pending.mjs")) await main();
