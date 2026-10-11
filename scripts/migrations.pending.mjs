// WHAT HAS NOT BEEN APPLIED TO PRODUCTION YET.
//
//   npm run migrations:pending            # ask, and report
//   npm run migrations:pending -- --write # ask, report, and regenerate supabase/APPLY_ALL_PENDING.sql
//   npm run migrations:pending -- --held=0376 --write   # …holding 0376 back as well, for this run only
//
// Migrations held back ON PURPOSE live in supabase/held.json (file + what each waits for), read by this
// and by scripts/verify.prod.mjs — so the production gate names a held migration instead of going red on
// every run until it lands (2026-10-11: 0376 waits for an iPhone build; Production #140–#143 were red for it).
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
const HELD = join(ROOT, "supabase", "held.json");
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
 * The migrations held back on purpose (supabase/held.json), as `{ file, seq, until, since }`. Every entry must name
 * a file that exists here and say what it waits for: a held list naming a file that is not there is a typo that
 * would otherwise hide a real gap, so it throws instead of being skipped. No file = nothing held.
 */
export function heldMigrations(files = migrationFiles(), path = HELD) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw new Error(`supabase/held.json does not read: ${e.message}`);
  }
  const list = Array.isArray(raw?.held) ? raw.held : [];
  return list.map((h) => {
    const m = files.find((x) => x.file === h?.file);
    if (!m) throw new Error(`supabase/held.json holds ${h?.file ?? "an entry with no file"}, which is not in supabase/migrations/`);
    if (!h.until) throw new Error(`supabase/held.json holds ${h.file} without saying what it waits for ("until")`);
    return { file: m.file, seq: m.seq, until: String(h.until), since: h.since ? String(h.since) : null };
  });
}

/**
 * The exact comparison, when the ledger hands over its numbers (/api/migrations `seqs`, 2026-10-11). Two integers
 * can say that a migration below the high-water mark never ran but not WHICH; the numbers can, by name. Duplicate
 * numbers (0007, 0040) count as often as they occur on each side.
 *   missing — files at or below the ledger's highest number with no row for them
 *   above   — files numbered after it (written, not yet applied)
 *   extra   — recorded numbers this directory has no file for
 */
export function ledgerDiff(files, seqs) {
  const have = new Map();
  let maxSeq = null;
  for (const s of seqs) { have.set(s, (have.get(s) ?? 0) + 1); if (maxSeq === null || s > maxSeq) maxSeq = s; }
  const missing = [], above = [];
  for (const m of files) {
    const n = have.get(m.seq) ?? 0;
    if (n > 0) { have.set(m.seq, n - 1); continue; }
    (maxSeq !== null && m.seq <= maxSeq ? missing : above).push(m);
  }
  const extra = [...have.entries()].flatMap(([s, n]) => Array(n).fill(s));
  return { missing, above, extra, maxSeq };
}

/** A file's name, or "one of …" when its number is shared and the ledger's numbers cannot say which of the pair. */
const nameOf = (m, files) => {
  const twins = files.filter((x) => x.seq === m.seq);
  return twins.length > 1 ? `one of ${twins.map((x) => x.file).join(" / ")}` : m.file;
};

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
export function pendingFrom(files, count, maxSeq, held = [], seqs = null) {
  // HELD ON PURPOSE (2026-10-11). A migration can be written, shipped and deliberately NOT applied until something
  // outside the database is true — 0376 waits for the iPhone build that answers its alert to be on the crew's phones,
  // while 0377–0380 go ahead. Two integers cannot tell a held migration from a forgotten one, so a person names it
  // (supabase/held.json, or --held=0376): it is left out of the count, left OUT of the paste file (pasting "all
  // pending" must never apply it early), and named in the file's header instead.
  const heldSet = new Set(held);
  // THE NUMBERS, WHEN THE LEDGER SENDS THEM (2026-10-11). Exact, by name: the gap names what is missing, a held
  // migration is checked to be the one missing (not merely one of the same count), and one already applied is said.
  // Only when the list is whole — `seqs` short of `count` means a capped read, and the two integers decide instead.
  if (Array.isArray(seqs) && seqs.length > 0 && seqs.length === count) {
    const d = ledgerDiff(files, seqs);
    const missing = d.missing.filter((m) => !heldSet.has(m.seq));
    const heldApplied = [...heldSet].filter((s) => files.some((m) => m.seq === s)
      && !d.missing.some((m) => m.seq === s) && !d.above.some((m) => m.seq === s));
    if (missing.length) {
      return {
        status: "gap", missing, heldApplied,
        reason: `${missing.length} migration(s) below the high-water mark never ran: ${missing.map((m) => nameOf(m, files)).join(", ")}`,
      };
    }
    if (d.extra.length) {
      return { status: "gap", missing: [], heldApplied, reason: `the database has ${d.extra.length} migration(s) this directory does not (number ${d.extra.map((s) => String(s).padStart(4, "0")).join(", ")})` };
    }
    const pending = d.above.filter((m) => !heldSet.has(m.seq));
    return { status: pending.length ? "pending" : "clean", pending, heldApplied, exact: true };
  }
  if (heldSet.size) files = files.filter((m) => !heldSet.has(m.seq));
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
export function pasteHeader(highest, generatedAt, pendingCount, source = "unknown", heldFiles = []) {
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
    ...heldFiles.map((f) => `-- held: ${f} — NOT in this file; applied by hand once the condition in its header is met`),
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
  let listed;
  try { listed = heldMigrations(files); } catch (e) {
    console.log(`MIGRATIONS PENDING: ${e.message}. Nothing was written.`);
    return;
  }
  const heldArg = (process.argv.find((a) => a.startsWith("--held=")) || "").slice("--held=".length);
  const asked = heldArg ? heldArg.split(",").map((x) => Number(x.trim())).filter(Number.isFinite) : [];
  if (asked.some((s) => !files.some((m) => m.seq === s))) {
    console.log(`MIGRATIONS PENDING: --held names a number with no file here (${asked.join(", ")}). Nothing was written.`);
    return;
  }
  const held = [...new Set([...listed.map((h) => h.seq), ...asked])];
  const verdict = pendingFrom(files, count, maxSeq, held, ledger.seqs);
  // A held migration the ledger already records was applied: it is not held any more, and the header must not say so.
  const applied = new Set(verdict.heldApplied ?? []);
  const heldFiles = files.filter((m) => held.includes(m.seq) && !applied.has(m.seq)).map((m) => m.file);

  console.log(`MIGRATIONS PENDING — ${source}${verdict.exact ? " (by number)" : ""}`);
  console.log(`  ledger:    ${count} applied, high-water mark ${String(maxSeq ?? 0).padStart(4, "0")}`);
  console.log(`  directory: ${files.length} file(s), highest ${String(highest).padStart(4, "0")}`);
  for (const f of heldFiles) {
    const why = listed.find((h) => h.file === f);
    console.log(`  held:      ${f} — ${why ? `until ${why.until} (supabase/held.json)` : "named with --held"}; left out of the count and of the paste file`);
  }
  for (const s of applied) console.log(`  applied:   ${files.find((m) => m.seq === s)?.file} is held but the ledger records it — take it out of supabase/held.json`);

  if (verdict.status === "gap") {
    console.log(`\n  ✗ REFUSING TO GUESS — ${verdict.reason}.`);
    if (!verdict.missing) {
      console.log(`\n  Two integers cannot name which one is missing. Run this in the SQL editor and`);
      console.log(`  compare it against supabase/migrations/ by hand:\n`);
      console.log(`      select version, seq from public.schema_migrations order by seq, version;\n`);
    } else {
      console.log(`\n  A migration skipped mid-history is applied by hand, on its own, after reading what came after it —`);
      console.log(`  never pasted in with the rest. If it is waiting on purpose, name it in supabase/held.json.`);
    }
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
        heldFiles.length
          ? "-- Nothing is pending but the held migration(s) named above, which are applied by hand, each on its own yes."
          : "-- Nothing is pending. Every migration in supabase/migrations/ is recorded in the ledger.",
        "-- This file is kept (rather than deleted) so the command that regenerates it stays in one",
        "-- place and the gate in drift.check.mjs has something to read.",
        "",
      ].join("\n");

  writeFileSync(OUT, pasteHeader(highest, new Date().toISOString().slice(0, 10), verdict.pending.length, source, heldFiles) + body);
  console.log(`\n  wrote supabase/APPLY_ALL_PENDING.sql — pending-from ${String(highest).padStart(4, "0")}, ${verdict.pending.length} migration(s) inside.`);
}

// Only run when invoked directly, so the pure functions above can be imported by a test.
if (process.argv[1] && process.argv[1].endsWith("migrations.pending.mjs")) await main();
