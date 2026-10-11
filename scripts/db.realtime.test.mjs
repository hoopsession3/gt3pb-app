// THE 86 BOARD AND BREW STATUS UPDATE LIVE — 0370, executed from its file against a real Postgres.
//
// Realtime sends a screen a table's changes only when the page subscribes AND the table is in the supabase_realtime
// publication. The 86 board, the menu and the pass subscribe to products; the brew board, the calendar and the
// prep screen to brew_batches. Neither table was ever in the publication, so a change on one device reached no
// other. Three worlds:
//   1. a small one shaped like production: the publication holding orders (0005) and not the two; 0370 adds both,
//      and a second run changes nothing — where a bare `alter publication … add table` would fail the second time;
//   2. a database with no realtime publication: 0370 runs, adds nothing, creates nothing;
//   3. the whole schema (scripts/fixtures/schema.full.mjs, every migration in order), checked the way
//      db.officerun checks business_orders: neither table a member with every migration before 0370 applied, both
//      after the last.
// STUBBED in 1 and 2: products and brew_batches carry only an id and the column the screens flip (their policies
// are 0062's and 0079's, unchanged and not what is under test); changelog and the ledger are the other tests' shapes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "0370_the_86_board_and_brew_status_update_live";
const sql = readFileSync(join(ROOT, `supabase/migrations/${FILE}.sql`), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const raises = async (db, s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };
const member = async (db, t) => (await db.query(
  `select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = $1) e`, [t])).rows[0].e;
const members = async (db) => Number((await db.query(
  `select count(*) n from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].n);
const LEDGER = `
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid,
    applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
  create table public.orders (id uuid primary key default gen_random_uuid(), status text not null default 'new');
  create table public.products (id uuid primary key default gen_random_uuid(), slug text, sold_out boolean not null default false);
  create table public.brew_batches (id uuid primary key default gen_random_uuid(), status text not null default 'planned');`;

// ── 1 · production's shape ────────────────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(LEDGER + `
    create publication supabase_realtime;
    alter publication supabase_realtime add table public.orders;`);
  ok("before 0370: the 86 board's table is not in the publication — its changes reach no other screen", (await member(db, "products")) === false);
  ok("before 0370: …nor brew_batches", (await member(db, "brew_batches")) === false);
  ok("adding a table that is already a member is an error in Postgres — why each add is guarded",
    /already member of publication/i.test((await raises(db, "alter publication supabase_realtime add table public.orders")) ?? ""));
  const n0 = await members(db);
  await db.exec(sql);
  console.log("0370 executed against a real Postgres.\n");
  ok("0370: products is in the publication", (await member(db, "products")) === true);
  ok("0370: brew_batches is in the publication", (await member(db, "brew_batches")) === true);
  ok("0370: …and nothing else changed: orders is still a member, and the publication holds two more tables",
    (await member(db, "orders")) === true && (await members(db)) === n0 + 2, { before: n0, after: await members(db) });
  ok("it says so in the changelog, once", Number((await db.query(
    "select count(*) n from public.changelog where title = 'The 86 board and brew status update on every screen' and category = 'fix'")).rows[0].n) === 1);
  ok("it records itself", (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 1);
  ok("run again: no error, the same members, one changelog line, recorded twice", (await raises(db, sql)) === null
    && (await members(db)) === n0 + 2
    && Number((await db.query("select count(*) n from public.changelog where title = 'The 86 board and brew status update on every screen'")).rows[0].n) === 1
    && (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 2);
  // One table already in it — a project where somebody switched one on by hand: the other is still added.
  const db2 = new PGlite();
  await db2.exec(LEDGER + `
    create publication supabase_realtime;
    alter publication supabase_realtime add table public.products;`);
  ok("a publication that already holds one of them: no error, and the other joins",
    (await raises(db2, sql)) === null && (await member(db2, "products")) && (await member(db2, "brew_batches")) && (await members(db2)) === 2);
  await db2.close();
  await db.close();
}

// ── 2 · no realtime publication at all ────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(LEDGER);
  ok("a database without the publication: 0370 runs without error", (await raises(db, sql)) === null);
  ok("…creates no publication and adds nothing", Number((await db.query(`select count(*) n from pg_publication`)).rows[0].n) === 0);
  ok("…and still records itself", (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 1);
  await db.close();
}

// ── 3 · the whole schema, every migration in order ────────────────────────────────────────────────
{
  const before = await fullSchema({ before: "0370" });
  ok("every migration before 0370: neither products nor brew_batches was ever added",
    (await member(before, "products")) === false && (await member(before, "brew_batches")) === false);
  ok("…while the tables they sit beside are members (orders, 0005; business_orders, 0357)",
    (await member(before, "orders")) === true && (await member(before, "business_orders")) === true);
  await before.close();
  const db = await fullSchema();
  ok("every migration: products is in the realtime publication", (await member(db, "products")) === true);
  ok("every migration: brew_batches is in the realtime publication", (await member(db, "brew_batches")) === true);
  await db.close();
}

console.log(`0370 (the 86 board and brew status update live): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
