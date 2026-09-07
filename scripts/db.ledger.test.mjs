// MIGRATIONS LEDGER CONTRACT — 0304, executed from its file.
//
// The ledger exists because nothing in the database recorded what had been applied to it, so every
// answer to "what is still pending" came from someone's memory of the repo. The two things most
// likely to make it quietly wrong are both tested here: the duplicate migration numbers (0007 and
// 0040 are each used by two different files, so a ledger keyed on the number loses one of each
// pair and then reports a complete history that is missing two migrations), and the re-run case (a
// migration run twice must record that fact rather than erroring or rewriting its own history).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RYAN = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};
const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const raises = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message || e); } };

// ── platform stubs ──────────────────────────────────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create role anon; create role authenticated;
  grant usage on schema auth, public to anon, authenticated;
  insert into auth.users values ('${RYAN}', 'ryan@gt3pb.com');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true) <> 'off', true) $$;

  create table public.changelog (
    id uuid primary key default gen_random_uuid(),
    title text, category text, area text, summary text,
    shipped_on date, highlight boolean default false
  );
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0304_migrations_ledger.sql"), "utf8"));

// ── the backfill ────────────────────────────────────────────────────────────────────────────────
const total = Number((await q1(`select count(*) c from public.schema_migrations`))?.c);
ok("ledger: every migration file in the repo has a row", total === 302, total);  // 301 backfilled + 0304 itself

// The whole reason version is the filename and not the number.
ok("ledger: BOTH files numbered 0007 are recorded",
  Number((await q1(`select count(*) c from public.schema_migrations where seq = 7`))?.c) === 2,
  await rows(`select version from public.schema_migrations where seq = 7 order by version`));
ok("ledger: BOTH files numbered 0040 are recorded",
  Number((await q1(`select count(*) c from public.schema_migrations where seq = 40`))?.c) === 2,
  await rows(`select version from public.schema_migrations where seq = 40 order by version`));
ok("ledger: and they are told apart by name, not by number",
  (await rows(`select version from public.schema_migrations where seq = 7 order by version`))
    .map((r) => r.version).join(",") === "0007_fix_grants,0007_stop_notes");

// ── how much each row is actually worth ─────────────────────────────────────────────────────────
const ev = await rows(`select evidence, count(*)::int c from public.schema_migrations group by 1 order by 1`);
const by = Object.fromEntries(ev.map((r) => [r.evidence, r.c]));
// 0267-0303 is 36 files. My first draft of this assertion said 37 — off by one because I counted
// 0304 itself, which is stamped, not verified. Exact numbers here on purpose: a range check would
// have passed on the wrong answer, which is the failure mode this whole session keeps hitting.
ok("ledger: the 36 files from 0267 to 0303 are marked verified — those were checked against production",
  by.verified === 36, by);
ok("ledger: the 265 files before them are marked inferred, and none is dressed up as verified",
  by.inferred === 265, by);
ok("ledger: 0304 stamped itself as it ran", by.stamped === 1, by);
ok("ledger: no backfilled row claims an applied date it cannot know",
  Number((await q1(`select count(*) c from public.schema_migrations
                     where evidence <> 'stamped' and applied_at is not null`))?.c) === 0);
ok("ledger: the stamped row DOES carry one",
  (await q1(`select applied_at from public.schema_migrations where evidence = 'stamped'`))?.applied_at !== null);
ok("ledger: an unknown evidence value is refused",
  (await raises(`insert into public.schema_migrations (version, seq, evidence) values ('9999_x', 9999, 'probably')`)) !== null);

// ── the stamp ───────────────────────────────────────────────────────────────────────────────────
await db.exec(`set test.uid = '${RYAN}'`);
const first = await q1(`select * from public.record_migration('0305_something', 'first run')`);
ok("stamp: a new migration lands as stamped, with its number parsed out",
  first?.evidence === "stamped" && Number(first?.seq) === 305, first);
ok("stamp: and records who ran it", first?.applied_by === RYAN, first?.applied_by);
ok("stamp: applied_count starts at one", Number(first?.applied_count) === 1);

const second = await q1(`select * from public.record_migration('0305_something', 'ran it again')`);
ok("stamp: running the same migration twice bumps the count rather than erroring",
  Number(second?.applied_count) === 2, second);
ok("stamp: a re-run does not multiply rows",
  Number((await q1(`select count(*) c from public.schema_migrations where version = '0305_something'`))?.c) === 1);
ok("stamp: the note from the later run is kept", second?.note === "ran it again");

// A backfilled row that later gets stamped is an upgrade in evidence, not a duplicate.
const upgraded = await q1(`select * from public.record_migration('0293_count_and_batch_chain', 're-applied')`);
ok("stamp: re-running a backfilled migration upgrades it from verified to stamped",
  upgraded?.evidence === "stamped" && upgraded?.applied_at !== null, upgraded);

ok("stamp: a name with no leading number is refused — it cannot be ordered",
  (await raises(`select public.record_migration('add_some_index')`)) !== null);
ok("stamp: an empty version is refused",
  (await raises(`select public.record_migration('   ')`)) !== null);

// ── gaps ────────────────────────────────────────────────────────────────────────────────────────
const gaps = await rows(`select * from public.v_migration_gaps order by missing_number`);
ok("gaps: the four numbers that were already empty are the only ones reported",
  gaps.map((g) => Number(g.missing_number)).join(",") === "29,66,224,273", gaps);
ok("gaps: and every one of them is flagged as known-empty, so the view reads clean",
  gaps.every((g) => g.known_empty_at_0304 === true), gaps);

// The point of the view: a migration that exists but was never run here shows up.
await db.exec(`delete from public.schema_migrations where seq = 200`);
const afterDelete = await rows(`select * from public.v_migration_gaps where not known_empty_at_0304`);
ok("gaps: a migration this database never ran is reported, and NOT flagged as known-empty",
  afterDelete.length === 1 && Number(afterDelete[0].missing_number) === 200, afterDelete);

// ── the summary ─────────────────────────────────────────────────────────────────────────────────
const st = await q1(`select * from public.v_migration_status`);
ok("status: it names the newest migration by version, not just its number",
  typeof st?.latest_version === "string" && st.latest_version.startsWith("0305"), st?.latest_version);
ok("status: it counts what has been run more than once",
  Number(st?.run_more_than_once) === 2, st);
ok("status: the evidence split adds up to the whole table",
  Number(st.stamped) + Number(st.verified) + Number(st.inferred) === Number(st.migrations_recorded), st);

// ── it is not writable through the API ──────────────────────────────────────────────────────────
ok("ledger: row level security is on",
  (await q1(`select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass`))?.relrowsecurity === true);
const grants = await rows(`select privilege_type from information_schema.role_table_grants
                            where table_name = 'schema_migrations' and grantee = 'authenticated'`);
ok("ledger: staff can read it and nothing more — history is not editable from the app",
  grants.map((g) => g.privilege_type).sort().join(",") === "SELECT", grants);

console.log(`MIGRATIONS LEDGER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
