// THE PORCH RUN UPDATES LIVE — 0378, executed from its file against a real Postgres (2026-10-11, the dispatch round).
//
// Realtime sends a screen a table's changes only when the page subscribes AND the table is in the supabase_realtime
// publication. The Sunday card (components/DeliveryOps, and Due next's list built from it), the driver's run
// (components/DriverRun) and the customer's delivery card (components/MyDeliveries) all subscribe to delivery_orders,
// and it was never in the publication. Four checks:
//   0. the census the migration's header leans on: the tables migrations added before 0248 are 34 — the number 0248
//      measured in production's publication — and delivery_orders is not among them, nor added by any migration since;
//   1. a small database shaped like production: the publication holds orders and business_orders, not delivery_orders;
//      0378 adds it, and a second run changes nothing — where a bare `alter publication … add table` fails;
//   2. a database with no realtime publication: 0378 runs, adds nothing, creates nothing;
//   3. the whole schema (scripts/fixtures/schema.full.mjs, every migration in order): not a member before 0378, a
//      member after the last.
// STUBBED in 1 and 2: the three tables carry only an id and a status (their policies are 0139's, 0005's and 0187's,
// unchanged and not what is under test); changelog and the ledger are the other tests' shapes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "0378_the_porch_run_updates_live";
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
  create table public.business_orders (id uuid primary key default gen_random_uuid(), status text not null default 'received');
  create table public.delivery_orders (id uuid primary key default gen_random_uuid(), status text not null default 'received');`;
const TITLE = "The Sunday porch run updates on every screen";

// ── 0 · the census ────────────────────────────────────────────────────────────────────────────────
{
  const dir = join(ROOT, "supabase", "migrations");
  const added = (files) => new Set(files.flatMap((f) =>
    [...readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "").matchAll(/alter publication supabase_realtime add table ([^;]+);/gi)]
      .flatMap((m) => m[1].split(",").map((t) => t.trim().replace(/^public\./, "")))));
  const all = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const before = added(all.filter((f) => f < "0248"));
  ok("census: migrations before 0248 added exactly 34 tables — the 34 that 0248 counted in production", before.size === 34, before.size);
  ok("census: delivery_orders is not one of them", !before.has("delivery_orders"));
  const since = all.filter((f) => f >= "0248" && f < "0378").filter((f) => /delivery_orders/.test(
    [...readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "").matchAll(/alter publication supabase_realtime add table[^;]*;|foreach t in array array\[[^\]]*\]/gi)].map((m) => m[0]).join(" ")));
  ok("census: nor did any migration since add it", since.length === 0, since);
}

// ── 1 · production's shape ────────────────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(LEDGER + `
    create publication supabase_realtime;
    alter publication supabase_realtime add table public.orders, public.business_orders;`);
  ok("before 0378: delivery_orders is not in the publication — the porch run's changes reach no other screen", (await member(db, "delivery_orders")) === false);
  ok("adding a table that is already a member is an error in Postgres — why the add is guarded",
    /already member of publication/i.test((await raises(db, "alter publication supabase_realtime add table public.business_orders")) ?? ""));
  const n0 = await members(db);
  await db.exec(sql);
  console.log("0378 executed against a real Postgres.\n");
  ok("0378: delivery_orders is in the publication", (await member(db, "delivery_orders")) === true);
  ok("0378: …and nothing else changed: orders and business_orders still members, one table more",
    (await member(db, "orders")) && (await member(db, "business_orders")) && (await members(db)) === n0 + 1, { before: n0, after: await members(db) });
  ok("it says so in the changelog, once", Number((await db.query(
    "select count(*) n from public.changelog where title = $1 and category = 'fix' and area = 'Delivery'", [TITLE])).rows[0].n) === 1);
  ok("it records itself", (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 1);
  ok("run again: no error, the same members, one changelog line, recorded twice", (await raises(db, sql)) === null
    && (await members(db)) === n0 + 1
    && Number((await db.query("select count(*) n from public.changelog where title = $1", [TITLE])).rows[0].n) === 1
    && (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 2);
  // A project where somebody switched it on by hand in the dashboard: nothing to do, and no error.
  const db2 = new PGlite();
  await db2.exec(LEDGER + `
    create publication supabase_realtime;
    alter publication supabase_realtime add table public.delivery_orders;`);
  ok("a publication that already holds it: no error, still one member", (await raises(db2, sql)) === null && (await member(db2, "delivery_orders")) && (await members(db2)) === 1);
  await db2.close();
  await db.close();
}

// ── 2 · no realtime publication at all ────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(LEDGER);
  ok("a database without the publication: 0378 runs without error", (await raises(db, sql)) === null);
  ok("…creates no publication and adds nothing", Number((await db.query(`select count(*) n from pg_publication`)).rows[0].n) === 0);
  ok("…and still records itself", (await db.query(`select applied_count from public.schema_migrations where version = '${FILE}'`)).rows[0]?.applied_count === 1);
  await db.close();
}

// ── 3 · the whole schema, every migration in order ────────────────────────────────────────────────
{
  const before = await fullSchema({ before: "0378" });
  ok("every migration before 0378: delivery_orders was never added",
    (await member(before, "delivery_orders")) === false);
  ok("…while the tables beside it are members (drop_orders, 0119; business_orders, 0357)",
    (await member(before, "drop_orders")) === true && (await member(before, "business_orders")) === true);
  await before.close();
  const db = await fullSchema();
  ok("every migration: delivery_orders is in the realtime publication", (await member(db, "delivery_orders")) === true);
  ok("…and the staff and own-read policies it is sent under are still the table's (0139)",
    Number((await db.query(`select count(*) n from pg_policies where tablename = 'delivery_orders' and policyname in ('delivery staff read', 'delivery own read')`)).rows[0].n) === 2);
  await db.close();
}

console.log(`0378 (the porch run updates live): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
