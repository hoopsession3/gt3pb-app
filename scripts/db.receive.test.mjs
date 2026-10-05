// A DELIVERY LANDS ON ITS SHELF — 0347, against a real Postgres.
//
// 0293's receive_lot() is run from its file first, to show what calling it would have done — the
// first delivery onto a shelf that had only ever been counted by hand REPLACED the count, and the lot
// never named its supplier — because a fix whose bug you cannot demonstrate is a fix you cannot
// trust. Then 0347: the opening balance, the supplier and its terms, one function where there were
// two, one shelf name per city, the shelf's supplier as a link, and the whole file run twice.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const rows = async (s, p) => (await db.query(s, p)).rows;
const q1 = async (s, p) => (await rows(s, p))[0];
const raises = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return String(e.message || e); } };
const T1 = "00000000-0000-0000-0000-000000000001", T2 = "00000000-0000-0000-0000-000000000002";

await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true) <> 'off', true) $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$ select '${T1}'::uuid $$;
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}'), ('${T2}');
  create table public.markets (slug text primary key);
  insert into public.markets values ('greenville'), ('atlanta');
  create table public.vendors (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}', name text not null,
    kind text, price_basis text, status text not null default 'approved', archived_at timestamptz);
  create table public.expenses (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    vendor_id uuid references public.vendors(id) on delete set null, category text not null default 'other', amount_cents int not null default 0,
    market text not null default 'greenville');
  create table public.inventory_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    name text not null, qty numeric, unit text, kind text, vendor text,
    market text not null default 'greenville' references public.markets(slug));
  create unique index inventory_tenant_name_uniq on public.inventory_items(tenant_id, name);
  create table public.inventory_lots (
    id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T1}',
    market text not null default 'greenville' references public.markets(slug), item_name text not null, lot_code text,
    received_on date not null default current_date, qty_received numeric not null check (qty_received > 0), unit text,
    unit_cost_cents int check (unit_cost_cents is null or unit_cost_cents >= 0),
    expense_id uuid references public.expenses(id) on delete set null, vendor_id uuid references public.vendors(id) on delete set null,
    notes text, created_by uuid, created_at timestamptz not null default now(),
    price_basis text check (price_basis is null or price_basis in ('retail','wholesale','distributor')));
  create table public.inventory_ledger (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default '${T1}',
    item text not null, market text not null default 'greenville' references public.markets(slug), kind text not null default 'confirm',
    qty numeric not null, note text, lot_id uuid references public.inventory_lots(id) on delete set null, batch_id uuid,
    created_by uuid, created_at timestamptz not null default now());
  create view public.inventory_on_hand as select item, market, sum(qty) as on_hand from public.inventory_ledger group by item, market;
  create view public.inventory_status as
    select i.id, i.name, i.market, i.qty, coalesce(oh.on_hand, i.qty) as effective_on_hand
      from public.inventory_items i left join public.inventory_on_hand oh on oh.item = i.name and oh.market = i.market;
`);

const SPROUTS = (await q1(`insert into public.vendors (name, kind, price_basis) values ('Sprouts Farmers Market', 'supplier', 'retail') returning id`)).id;
const DEPOT = (await q1(`insert into public.vendors (name, kind, price_basis) values ('Restaurant Depot', 'both', 'wholesale') returning id`)).id;
const shelf = (name, qty, market = "greenville", vendor = null) =>
  q1(`insert into public.inventory_items (name, qty, unit, kind, market, vendor) values ($1, $2, 'lb', 'ingredient', $3, $4) returning id`, [name, qty, market, vendor]);
const onHand = async (name, market = "greenville") => Number((await q1(`select effective_on_hand from public.inventory_status where name = $1 and market = $2`, [name, market])).effective_on_hand);
const expense = async (vendor) => (await q1(`insert into public.expenses (vendor_id, category, amount_cents) values ($1, 'ingredients', 9594) returning id`, [vendor])).id;

// (Called as `select * from f()`, never `select (f()).*` — the second runs the function once per
// column of its result, and received six pounds fifteen times on the first run of this file.)
// ── 1 · WHAT 0293 WOULD HAVE DONE ──────────────────────────────────────────────────────────────
const src293 = readFileSync(join(ROOT, "supabase/migrations/0293_count_and_batch_chain.sql"), "utf8");
const start293 = src293.indexOf("create or replace function public.receive_lot(");
const fn293 = src293.slice(start293, src293.indexOf("end $$;", start293) + 7);
await db.exec(fn293);
await shelf("Org Ethiopia Coffee (bulk)", 10);
const e1 = await expense(SPROUTS);
const lot293 = await q1(`select * from public.receive_lot('greenville', 'Org Ethiopia Coffee (bulk)', 6, 'lb', 1599, 'SPROUTS-1', $1)`, [e1]);
ok("0293: six pounds received onto a shelf showing ten leaves it showing six — the ten vanish", (await onHand("Org Ethiopia Coffee (bulk)")) === 6, await onHand("Org Ethiopia Coffee (bulk)"));
ok("0293: the lot does not say who it came from, though the purchase does", lot293.vendor_id === null && lot293.price_basis === null);
ok("0293: Atlanta cannot add the shelf Greenville already has", /duplicate key|unique/i.test(await raises(`insert into public.inventory_items (name, market) values ('Org Ethiopia Coffee (bulk)', 'atlanta')`) ?? ""));

// ── 2 · 0347 ───────────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0347_a_delivery_lands_on_its_shelf.sql"), "utf8");
// Typed suppliers before the link exists: exactly one vendor, case and spacing aside — linked; the rest kept as typed.
await db.query(`insert into public.inventory_items (name, qty, market, vendor) values
  ('Spring Water Case', 4, 'greenville', '  sprouts   farmers market '),
  ('Cups 16 oz', 500, 'greenville', 'Amazon'),
  ('Lids 16 oz', 500, 'greenville', 'Costco'),
  ('Straws', 1000, 'greenville', 'Crew Supply Co'),
  ('Labels', 300, 'greenville', 'Restaurant Depot')`);
await db.query(`insert into public.vendors (name, kind) values ('Costco', 'supplier'), ('costco', 'supplier')`);       // two of one name: ambiguous
await db.query(`insert into public.vendors (name, kind, archived_at) values ('Crew Supply Co', 'supplier', now())`);   // archived: not a link
await db.query(`insert into public.vendors (tenant_id, name, kind) values ('${T2}', 'Amazon', 'supplier')`);            // another business's
await db.exec(SQL);

const link = async (name) => (await q1(`select vendor_id from public.inventory_items where name = $1 and market = 'greenville'`, [name])).vendor_id;
ok("link: a typed name that is exactly one vendor's is linked, case and spacing aside", (await link("Spring Water Case")) === SPROUTS && (await link("Labels")) === DEPOT);
ok("link: no vendor, two vendors of one name, an archived vendor, another business's vendor — none of them a link",
  (await link("Cups 16 oz")) === null && (await link("Lids 16 oz")) === null && (await link("Straws")) === null);
ok("link: the typed name is kept", (await q1(`select vendor from public.inventory_items where name = 'Cups 16 oz'`)).vendor === "Amazon");

const fns = await rows(`select pronargs from pg_proc where proname = 'receive_lot'`);
ok("one receive_lot, with eleven arguments — PostgREST never chooses between two", fns.length === 1 && fns[0].pronargs === 11, fns);
// The lock is the one 0318's set_on_hand takes, on the same key, and it is taken before anything is
// read: a recount and a delivery onto one shelf queue behind each other instead of interleaving.
const src = (await q1(`select prosrc from pg_proc where proname = 'receive_lot'`)).prosrc;
const key318 = readFileSync(join(ROOT, "supabase/migrations/0318_correcting_a_count_should_land_on_the_number_you_typed.sql"), "utf8")
  .match(/pg_advisory_xact_lock\(hashtextextended\(p_item \|\| '\|' \|\| \w+, 0\)\)/);
ok("0347: a delivery takes 0318's lock on (item, city) before it reads the shelf's ledger",
  !!key318 && /perform pg_advisory_xact_lock\(hashtextextended\(p_item \|\| '\|' \|\| p_market, 0\)\);/.test(src)
  && src.indexOf("pg_advisory_xact_lock") < src.indexOf("from public.inventory_ledger"));

// The shelf that has only ever been counted by hand keeps its count; the delivery lands on top.
const e2 = await expense(SPROUTS);
const lot = await q1(`select * from public.receive_lot('greenville', 'Spring Water Case', 2, 'case', 3499, null, $1)`, [e2]);
ok("0347: two cases onto a shelf showing four leaves six", (await onHand("Spring Water Case")) === 6, await onHand("Spring Water Case"));
const led = await rows(`select kind, qty::float as qty, note, lot_id from public.inventory_ledger where item = 'Spring Water Case' order by created_at, kind`);
ok("0347: the hand count opens the ledger first, and says so; the delivery is its own row, on its lot",
  led.length === 2 && led.some((r) => r.kind === "adjust" && r.qty === 4 && /Opening balance: the hand count \(4\)/.test(r.note) && r.lot_id === null)
  && led.some((r) => r.kind === "restock" && r.qty === 2 && r.lot_id === lot.id), led);
ok("0347: the lot names its supplier — the purchase's — and its terms — the supplier's", lot.vendor_id === SPROUTS && lot.price_basis === "retail" && lot.expense_id === e2 && lot.unit_cost_cents === 3499);
await db.query(`select public.receive_lot('greenville', 'Spring Water Case', 3, 'case', 3499)`);
ok("0347: the second delivery adds — no second opening row", (await onHand("Spring Water Case")) === 9
  && Number((await q1(`select count(*)::int as n from public.inventory_ledger where item = 'Spring Water Case' and kind = 'adjust'`)).n) === 1);
const lotX = await q1(`select * from public.receive_lot('greenville', 'Labels', 100, 'each', 12, 'DEP-9', $1, '2026-10-01', 'cases from the depot', $2, 'distributor')`, [e2, DEPOT]);
ok("0347: a supplier and terms the caller names win over the purchase's", lotX.vendor_id === DEPOT && lotX.price_basis === "distributor" && lotX.received_on instanceof Date);
await shelf("Cacao Nibs", null);
await db.query(`select public.receive_lot('greenville', 'Cacao Nibs', 2.2, 'lb')`);
ok("0347: a shelf with no hand count just takes the delivery", (await onHand("Cacao Nibs")) === 2.2
  && Number((await q1(`select count(*)::int as n from public.inventory_ledger where item = 'Cacao Nibs'`)).n) === 1);
await db.query(`select public.receive_lot('greenville', 'Org Ethiopia Coffee (bulk)', 6, 'lb', 1599, 'SPROUTS-2')`);
ok("0347: a shelf that already has a ledger is not opened again", (await onHand("Org Ethiopia Coffee (bulk)")) === 12);
ok("0347: 0293's six-argument call still works, positionally", lot293 !== null && (await q1(`select count(*)::int as n from public.inventory_lots where lot_code = 'SPROUTS-2'`)).n === 1);
ok("0347: still refuses a delivery of nothing, in 0293's words", /A delivery has to be more than zero/.test(await raises(`select public.receive_lot('greenville', 'Labels', 0)`) ?? ""));
ok("0347: still refuses a shelf that does not exist in that city", /No shelf called Labels in atlanta/.test(await raises(`select public.receive_lot('atlanta', 'Labels', 5)`) ?? ""));
ok("0347: a price basis that is not one is refused by the lot", !!(await raises(`select public.receive_lot('greenville', 'Labels', 5, 'each', 10, null, null, current_date, null, null, 'cheap')`)));
await db.exec(`set test.staff = 'off'`);
ok("0347: staff only", /staff only/.test(await raises(`select public.receive_lot('greenville', 'Labels', 5)`) ?? ""));
await db.exec(`set test.staff = 'on'`);

// One shelf name per city.
ok("cities: Atlanta can stock the item Greenville stocks", (await raises(`insert into public.inventory_items (name, market, qty) values ('Org Ethiopia Coffee (bulk)', 'atlanta', 4)`)) === null);
ok("cities: …but not twice", /duplicate key|unique/i.test(await raises(`insert into public.inventory_items (name, market) values ('Org Ethiopia Coffee (bulk)', 'atlanta')`) ?? ""));
await db.query(`select public.receive_lot('atlanta', 'Org Ethiopia Coffee (bulk)', 6, 'lb', 1599)`);
ok("cities: each city's shelf is its own — Atlanta opens at its four and takes six", (await onHand("Org Ethiopia Coffee (bulk)", "atlanta")) === 10 && (await onHand("Org Ethiopia Coffee (bulk)")) === 12);
const idx = (await rows(`select indexname from pg_indexes where tablename = 'inventory_items' and indexname like '%name_uniq'`)).map((r) => r.indexname);
ok("cities: the (tenant, name) index is gone; (tenant, market, name) holds", JSON.stringify(idx) === JSON.stringify(["inventory_items_tenant_market_name_uniq"]), idx);

// ── 3 · TWICE ──────────────────────────────────────────────────────────────────────────────────
await db.query(`update public.inventory_items set vendor_id = $1 where name = 'Cups 16 oz'`, [DEPOT]);
await db.exec(SQL);
ok("0347 twice: a link somebody made is not touched", (await link("Cups 16 oz")) === DEPOT);
ok("0347 twice: still one receive_lot", (await rows(`select 1 from pg_proc where proname = 'receive_lot'`)).length === 1);
ok("0347 twice: one changelog row, and the ledger counts the re-run",
  (await q1(`select count(*)::int as n from public.changelog where area = 'Inventory'`)).n === 1
  && (await q1(`select applied_count from public.schema_migrations where version = '0347_a_delivery_lands_on_its_shelf'`)).applied_count === 2);

console.log(`\nA DELIVERY LANDS ON ITS SHELF (0347): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
