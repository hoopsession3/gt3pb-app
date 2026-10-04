// AN OFFICE KEEPS ITS CITY AND ITS DOOR — 0346, against a real Postgres.
//
// 0282's generate_office_route is run verbatim from its file to prove both defects: a standing
// office's access notes never reach the orders it makes, and an account on an Atlanta ZIP — filed
// under the column default — is priced and windowed from Greenville's row. Then 0346: the account
// keeps its door, the generator carries it, existing rows are corrected (and only the ones that
// should be), and the restated function is 0282's apart from the door.
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
const U = "00000000-0000-0000-0000-0000000000c1";

await db.exec(`
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  create table public.live_status (id int primary key, office_price_cents int);
  insert into public.live_status values (1, 4500);
  create table public.markets (slug text primary key, office_price_cents int, office_min_gallons int, office_window text);
  insert into public.markets values ('greenville', 4500, 3, 'mon_0500_0800'), ('atlanta', 4800, 3, 'mon_0600_0900');
  create table public.business_accounts (id uuid primary key default gen_random_uuid(), user_id uuid, company text not null,
    contact_name text, contact_phone text, address_street text, address_city text, address_zip text, headcount int,
    billing_terms text, preferred_window text, standing_active boolean not null default false, standing_gallons int,
    market text not null default 'greenville', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.business_orders (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, company text,
    contact_name text, contact_phone text, address_street text, address_city text, address_zip text, access_instructions text,
    delivery_date date, delivery_window text, gallons int, price_per_gallon_cents int, subtotal_cents int, delivery_fee_cents int,
    tax_cents int, total_cents int, billing_terms text, standing boolean, market text not null default 'greenville',
    canceled_at timestamptz, created_at timestamptz not null default now());
`);

// ── 1 · THE BUG, AS 0282 LEFT IT ───────────────────────────────────────────────────────────────
const src282 = readFileSync(join(ROOT, "supabase/migrations/0282_market_office_terms.sql"), "utf8");
const fn282 = src282.slice(src282.indexOf("create or replace function public.generate_office_route(p_date date)"), src282.indexOf("end $$;", src282.indexOf("create or replace function public.generate_office_route")) + 7);
await db.exec(fn282);
const acct = async (o) => (await q1(`insert into public.business_accounts (user_id, company, address_street, address_city, address_zip, standing_active, standing_gallons, billing_terms)
  values ($1, $2, $3, $4, $5, true, $6, 'prepaid') returning id`, [U, o.company, o.street, o.city, o.zip, o.gal ?? 5])).id;
const order = (a, o) => db.query(`insert into public.business_orders (business_id, user_id, company, address_street, address_city, address_zip, access_instructions, delivery_date, gallons, standing, created_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, 5, true, $9)`, [a, U, o.company, o.street, o.city, o.zip, o.access ?? null, o.date, o.at ?? new Date().toISOString()]);

const gvl = await acct({ company: "Acme Greenville", street: "1 Main St", city: "Greenville", zip: "29601" });
await order(gvl, { company: "Acme Greenville", street: "1 Main St", city: "Greenville", zip: "29601", access: "Suite 300 — badge in at the front desk", date: "2026-09-28", at: "2026-09-25T12:00:00Z" });
const moved = await acct({ company: "Moved Co", street: "9 New Rd", city: "Greenville", zip: "29607" });
await order(moved, { company: "Moved Co", street: "4 Old Ave", city: "Greenville", zip: "29607", access: "Old lobby code 1234", date: "2026-09-28" });
const atl = await acct({ company: "Peach Towers", street: "100 Peachtree St", city: "Atlanta", zip: "30303" });
await order(atl, { company: "Peach Towers", street: "100 Peachtree St", city: "Atlanta", zip: "30303", access: "Dock B", date: "2026-09-28" });

await db.query(`select public.generate_office_route('2026-10-05')`);
const made = async (a, date) => q1(`select access_instructions, price_per_gallon_cents, delivery_window, market from public.business_orders where business_id = $1 and delivery_date = $2`, [a, date]);
ok("0282: the order the generator makes has no access notes, though the office's first one did", (await made(gvl, "2026-10-05")).access_instructions === null);
ok("0282: an account on an Atlanta ZIP is filed under the default — Greenville's price and window",
  (await made(atl, "2026-10-05")).price_per_gallon_cents === 4500 && (await made(atl, "2026-10-05")).delivery_window === "mon_0500_0800" && (await made(atl, "2026-10-05")).market === "greenville");

// ── 2 · 0346 ───────────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0346_an_office_keeps_its_city_and_its_door.sql"), "utf8");
await db.exec(SQL);
const acc = (a) => q1(`select access_instructions, market from public.business_accounts where id = $1`, [a]);
ok("existing rows: the account takes the notes from its latest order to the same door", (await acc(gvl)).access_instructions === "Suite 300 — badge in at the front desk");
ok("existing rows: an office that moved does not inherit its old lobby's code", (await acc(moved)).access_instructions === null);
ok("existing rows: an account on Atlanta's route list moves off the default", (await acc(atl)).market === "atlanta");
ok("existing rows: …and so do its orders, past and generated", Number((await q1(`select count(*)::int as n from public.business_orders where business_id = $1 and market <> 'atlanta'`, [atl])).n) === 0);
ok("existing rows: Greenville stays Greenville", (await acc(gvl)).market === "greenville" && (await acc(moved)).market === "greenville");

await db.query(`select public.generate_office_route('2026-10-12')`);
ok("0346: every standing order carries the account's door", (await made(gvl, "2026-10-12")).access_instructions === "Suite 300 — badge in at the front desk");
ok("0346: an Atlanta account is priced and windowed from Atlanta's row (0282's design, finally reached)",
  (await made(atl, "2026-10-12")).price_per_gallon_cents === 4800 && (await made(atl, "2026-10-12")).delivery_window === "mon_0600_0900" && (await made(atl, "2026-10-12")).market === "atlanta");
ok("0346: the duplicate guard still holds — a second run makes nothing", (await q1(`select public.generate_office_route('2026-10-12') as n`)).n === 0);

const live = (await q1(`select prosrc from pg_proc where proname = 'generate_office_route'`)).prosrc;
const body282 = fn282.slice(fn282.indexOf("$$") + 2, fn282.lastIndexOf("$$"));
ok("0346: the restated generator is 0282's, apart from the door",
  live.replace("address_street, address_city, address_zip, access_instructions, delivery_date, delivery_window,", "address_street, address_city, address_zip, delivery_date, delivery_window,")
      .replace("coalesce(a.address_zip, ''), a.access_instructions,", "coalesce(a.address_zip, ''),") === body282);

// The ZIP list in the migration is lib/delivery's, so the backfill moved exactly what the route would.
const delivery = readFileSync(join(ROOT, "lib/delivery.ts"), "utf8");
const atlBlock = delivery.slice(delivery.indexOf("atlanta: ["), delivery.indexOf("],", delivery.indexOf("atlanta: [")));
const libZips = [...atlBlock.matchAll(/"(\d{5})"/g)].map((m) => m[1]).sort();
const sqlLists = [...SQL.matchAll(/in\s*\n?\s*\(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'(\d{5})'/g)].map((x) => x[1]).sort());
ok("the migration's Atlanta list is lib/delivery's, both times it appears",
  sqlLists.length === 2 && sqlLists.every((l) => JSON.stringify(l) === JSON.stringify(libZips)) && libZips.length > 0, { lib: libZips.length, sql: sqlLists.map((l) => l.length) });

// ── 3 · TWICE ──────────────────────────────────────────────────────────────────────────────────
await db.query(`update public.business_accounts set access_instructions = 'Changed by the office' where id = $1`, [gvl]);
await db.exec(SQL);
ok("0346 twice: notes the account already has are not overwritten", (await acc(gvl)).access_instructions === "Changed by the office");
ok("0346 twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where area = 'Delivery'`)).n === 1);
ok("0346 twice: the ledger counts the re-run", (await q1(`select applied_count from public.schema_migrations where version = '0346_an_office_keeps_its_city_and_its_door'`)).applied_count === 2);

console.log(`\nAN OFFICE KEEPS ITS CITY AND ITS DOOR (0346): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
