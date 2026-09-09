// CORRECTING A COUNT — 0318, executed from its file.
//
// The claim being tested is narrow and worth stating exactly: when somebody types the count they
// are looking at, the ledger must end on THAT number. The old code computed `want - cur` in the
// browser from state loaded at mount, so it ended on `actual + want - cur`, which is only `want`
// while nothing else has moved the item. The first test below reproduces that arithmetic and shows
// it landing wrong, because a fix whose bug you cannot demonstrate is a fix you cannot trust.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const num = (v) => Number(v);

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.markets (slug text primary key);
  insert into public.markets (slug) values ('greenville'), ('atlanta');
  create table public.events (id uuid primary key default gen_random_uuid());
  create table public.stops  (id uuid primary key default gen_random_uuid());
  create table public.event_tasks (id uuid primary key default gen_random_uuid());
  create table public.inventory_ledger (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
    item text not null,
    market text not null default 'greenville' references public.markets(slug),
    event_id uuid references public.events(id) on delete set null,
    stop_id  uuid references public.stops(id)  on delete set null,
    task_id  uuid references public.event_tasks(id) on delete set null,
    kind text not null default 'confirm',
    qty numeric not null,
    note text,
    created_by uuid,
    created_at timestamptz not null default now()
  );
  -- 0288's shape: the balance is per SHELF, not per item.
  create view public.inventory_on_hand with (security_invoker = on) as
    select item, market, sum(qty) as on_hand, max(created_at) as last_movement
    from public.inventory_ledger group by item, market;
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
  create role authenticated;
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0318_correcting_a_count_should_land_on_the_number_you_typed.sql"), "utf8"));

const bal = async (item, market = "greenville") =>
  num((await q1(`select coalesce(sum(qty),0) b from public.inventory_ledger where item = '${item}' and market = '${market}'`))?.b);
const rowCount = async (item) => num((await q1(`select count(*) c from public.inventory_ledger where item = '${item}'`))?.c);

// ── THE BUG, REPRODUCED ────────────────────────────────────────────────────────────────────────
// Exactly what the browser did: read the balance, someone else moves stock, then write want - cur.
{
  await db.exec(`insert into public.inventory_ledger (item, kind, qty) values ('kegs', 'restock', 10);`);
  const curAtPageLoad = await bal("kegs");                       // 10 — what the screen was showing
  await db.exec(`insert into public.inventory_ledger (item, kind, qty) values ('kegs', 'use', -3);`); // someone logs use
  // The crew member counts 8 on the shelf and types 8.
  const want = 8;
  await db.exec(`insert into public.inventory_ledger (item, kind, qty) values ('kegs', 'adjust', ${want - curAtPageLoad});`);
  const landed = await bal("kegs");
  ok("the OLD arithmetic lands on the wrong number (7, not the 8 that was typed)",
    landed === 5, landed);
  // 10 - 3 + (8 - 10) = 5. Off by exactly the movement it never saw.
}

// ── THE FIX ────────────────────────────────────────────────────────────────────────────────────
{
  await db.exec(`insert into public.inventory_ledger (item, kind, qty) values ('bottles', 'restock', 10);`);
  const curAtPageLoad = await bal("bottles");
  await db.exec(`insert into public.inventory_ledger (item, kind, qty) values ('bottles', 'use', -3);`);
  ok("the stale figure the screen still shows is 10", curAtPageLoad === 10, curAtPageLoad);
  const returned = num((await q1(`select public.set_on_hand('bottles', 8) v`))?.v);
  ok("set_on_hand returns the count that was typed", returned === 8, returned);
  ok("and the shelf actually holds it, regardless of what the screen had", await bal("bottles") === 8);
}

// ── it writes a DELTA, not a total: the history has to survive ──────────────────────────────────
{
  const before = await rowCount("bottles");
  const d = num((await q1(`select qty v from public.inventory_ledger where item = 'bottles' and kind = 'adjust' order by created_at desc limit 1`))?.v);
  ok("the correction is recorded as the difference (+1), never as an absolute", d === 1, d);
  ok("and the earlier movements are still there", before === 3, before);
}

// ── a correction that changes nothing writes nothing ────────────────────────────────────────────
{
  const before = await rowCount("bottles");
  const r = num((await q1(`select public.set_on_hand('bottles', 8) v`))?.v);
  ok("setting the same count returns it", r === 8, r);
  ok("and adds NO row — an empty movement is not a record", await rowCount("bottles") === before);
}

// ── zero is a real count, not 'unset' ──────────────────────────────────────────────────────────
{
  const r = num((await q1(`select public.set_on_hand('bottles', 0) v`))?.v);
  ok("correcting to zero works and lands on zero", r === 0 && (await bal("bottles")) === 0, r);
}

// ── 0288's whole point: shelves are per market ──────────────────────────────────────────────────
{
  await db.exec(`insert into public.inventory_ledger (item, market, kind, qty) values ('cups', 'greenville', 'restock', 12);`);
  await db.exec(`insert into public.inventory_ledger (item, market, kind, qty) values ('cups', 'atlanta',    'restock', 4);`);
  await db.exec(`select public.set_on_hand('cups', 20, 'atlanta');`);
  ok("correcting Atlanta lands on Atlanta", await bal("cups", "atlanta") === 20);
  ok("and does NOT touch Greenville — the defect 0288 exists to prevent",
    await bal("cups", "greenville") === 12, await bal("cups", "greenville"));
  const oldWayTotal = num((await q1(`select coalesce(sum(qty),0) b from public.inventory_ledger where item = 'cups'`))?.b);
  ok("summing by item ALONE (what the load-out screen did) mixes the two cities into 32",
    oldWayTotal === 32, oldWayTotal);
}

// ── the markets contract: absent or blank can only mean the founding market ─────────────────────
{
  await db.exec(`select public.set_on_hand('lids', 7);`);
  ok("no market given → the founding one", await bal("lids", "greenville") === 7);
  await db.exec(`select public.set_on_hand('lids', 9, '   ');`);
  ok("a blank market is absent, not a new shelf called '   '", await bal("lids", "greenville") === 9);
  ok("and no stray shelf was created",
    num((await q1(`select count(distinct market) c from public.inventory_ledger where item = 'lids'`))?.c) === 1);
}

// ── it refuses the arguments it cannot act on ──────────────────────────────────────────────────
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message); } };
ok("a blank item is refused rather than filed under ''",
  /needs an item/.test(await raises(`select public.set_on_hand('  ', 5);`) ?? ""));
ok("a null count is refused rather than treated as zero",
  /needs the count/.test(await raises(`select public.set_on_hand('kegs', null);`) ?? ""));

// ── invoker rights, deliberately ───────────────────────────────────────────────────────────────
ok("set_on_hand is NOT security definer — it must not reach shelves the caller cannot see",
  (await q1(`select prosecdef d from pg_proc where proname = 'set_on_hand'`))?.d === false);

ok("0318 recorded itself by filename",
  (await q1(`select version v from public.schema_migrations where seq = 318`))?.v === "0318_correcting_a_count_should_land_on_the_number_you_typed");

console.log(`ON-HAND CORRECTION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
