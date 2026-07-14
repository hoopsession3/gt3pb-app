// VENDOR IDENTITY CONTRACT — acceptance tests for 0226 (locations, the ≥40% look-alike guard,
// owner-gated merge). Same philosophy as db.fieldops.test.mjs: in-process WASM Postgres with the
// REAL pg_trgm extension loaded, prod-fidelity fixture shapes, and the MIGRATION UNDER TEST
// applied verbatim from its real file.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};

const db = new PGlite({ extensions: { pg_trgm } });
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];

// ── platform stubs ───────────────────────────────────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon; create role authenticated;
  grant usage on schema auth, public to anon, authenticated;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$
    select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin new.tenant_id := coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid); return new; end $$;
`);

// ── vendors + dependents, prod-fidelity shapes (0034 + 0040 + 0165 + 0191) ──────────────────────
await db.exec(`
  create table public.vendors (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'New vendor',
    poc_name text, poc_phone text, poc_email text,
    address text, location_text text, lat double precision, lng double precision,
    service_dates text, notes text, archived_at timestamptz,
    sort int not null default 0, created_at timestamptz not null default now(),
    tenant_id uuid, vendor_type text,
    status text not null default 'approved' check (status in ('approved','pending','archived'))
  );
  create table public.stops  (id uuid primary key default gen_random_uuid(), vendor_id uuid references public.vendors(id) on delete set null);
  create table public.events (id uuid primary key default gen_random_uuid(), vendor_id uuid references public.vendors(id) on delete set null);
  create table public.opportunities (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade);
  create table public.meeting_notes (id uuid primary key default gen_random_uuid(), vendor_id uuid references public.vendors(id));
  create table public.expenses (id uuid primary key default gen_random_uuid(), vendor_id uuid references public.vendors(id));
  create table public.todos (id uuid primary key default gen_random_uuid(), assignee uuid, done boolean not null default false);
`);

// ── the WineXpress reality: three spellings pre-seeded (guard is INSERT-only, so seed pre-apply) ──
const WE = "11111111-0000-0000-0000-000000000001";
const WX = "11111111-0000-0000-0000-000000000002";
const W1 = "11111111-0000-0000-0000-000000000003";
await db.exec(`
  insert into public.vendors (id, name, address, poc_name) values
    ('${WE}', 'Wine Express', 'Five Forks, Simpsonville SC', null),
    ('${WX}', 'Wine Xpress', null, 'Sandy'),
    ('${W1}', 'WineXpress', null, null);
  insert into public.stops  (vendor_id) values ('${WX}'), ('${W1}');
  insert into public.events (vendor_id) values ('${W1}');
  insert into public.opportunities (vendor_id) values ('${WX}');
  insert into public.meeting_notes (vendor_id) values ('${W1}');
  insert into public.expenses (vendor_id) values ('${WX}');
`);

// ── APPLY THE REAL MIGRATION ─────────────────────────────────────────────────────────────────────
let applied = true;
try { await db.exec(readFileSync(join(ROOT, "supabase/migrations/0226_vendor_identity.sql"), "utf8")); }
catch (e) { applied = false; console.log(`  ✗ 0226 apply threw → ${e.message}`); }
ok("0226 applies verbatim (extension, table, guard, merge fn, backfill)", applied);

// ── 1 · backfill: baked-in address became the primary location ──────────────────────────────────
ok("backfill: Wine Express address became its primary location",
  (await q1(`select label || '|' || address || '|' || is_primary::text as r
             from public.vendor_locations where vendor_id = '${WE}'`))?.r === "Main|Five Forks, Simpsonville SC|true");
ok("backfill skips vendors with no location data",
  (await q1(`select count(*)::int as r from public.vendor_locations where vendor_id = '${W1}'`)).r === 0);

// ── 2 · similar_vendors: the candidate lookup the confirm sheet renders from ────────────────────
const sims = (await db.query(`select name, sim from public.similar_vendors('Wine Xpres')`)).rows;
ok("similar_vendors finds all three spellings for 'Wine Xpres'",
  sims.length >= 3 && sims.every((r) => r.sim >= 0.4), sims);
ok("similar_vendors is quiet for a genuinely distinct name",
  (await db.query(`select * from public.similar_vendors('Atlanta BeltLine')`)).rows.length === 0);

// ── 3 · the guard: refuses look-alikes, structured payload, confirm flag passes ─────────────────
let refused = null;
try { await db.exec(`insert into public.vendors (name) values ('Wine Expres');`); }
catch (e) { refused = e; }
ok("guard refuses a ≥40%-similar vendor insert", !!refused && /similar_vendor/.test(refused.message));
const payload = `${refused?.message ?? ""} ${refused?.detail ?? ""}`;
ok("guard payload names an existing match (structured detail for the confirm sheet)",
  /Wine (Express|Xpress)|WineXpress/.test(payload), payload.slice(0, 160));
ok("guard SQLSTATE is PT409 (PostgREST maps PTxyz → HTTP 409, never a false 5xx)",
  !refused?.code || refused.code === "PT409", refused?.code);
ok("guard: vendor count unchanged after refusal",
  (await q1(`select count(*)::int as r from public.vendors`)).r === 3);
await db.exec(`insert into public.vendors (name, confirmed_distinct) values ('Wine Expres', true);`);
ok("confirmed_distinct = true is the explicit 'create anyway' door",
  (await q1(`select count(*)::int as r from public.vendors where name = 'Wine Expres'`)).r === 1);
await db.exec(`delete from public.vendors where name = 'Wine Expres';`);
await db.exec(`insert into public.vendors (name) values ('Atlanta BeltLine');`);
ok("distinct names insert freely without the flag",
  (await q1(`select count(*)::int as r from public.vendors where name = 'Atlanta BeltLine'`)).r === 1);

// ── 4 · one primary per vendor, enforced ────────────────────────────────────────────────────────
let dupPrimary = false;
try { await db.exec(`insert into public.vendor_locations (vendor_id, label, is_primary) values ('${WE}', 'Second HQ', true);`); }
catch { dupPrimary = true; }
ok("a second primary location for the same vendor is refused", dupPrimary);
await db.exec(`insert into public.vendor_locations (vendor_id, label, address) values ('${WE}', 'Downtown', '123 Main St');`);
ok("non-primary additional locations add freely (multi-location vendor)",
  (await q1(`select count(*)::int as r from public.vendor_locations where vendor_id = '${WE}'`)).r === 2);

// ── 5 · merge_vendors: repoints everything, archives dupes, mirrors untouched ───────────────────
const merged = (await q1(`select public.merge_vendors('${WE}', array['${WX}','${W1}']::uuid[]) as r`)).r;
const rep = typeof merged === "string" ? JSON.parse(merged).repointed : merged.repointed;
ok("merge repointed 2 stops + 1 event + 1 opportunity + 1 note + 1 expense",
  rep.stops === 2 && rep.events === 1 && rep.opportunities === 1 && rep.meeting_notes === 1 && rep.expenses === 1, rep);
ok("no references to the dupes remain anywhere",
  (await q1(`select (select count(*) from public.stops where vendor_id in ('${WX}','${W1}'))
           + (select count(*) from public.events where vendor_id in ('${WX}','${W1}'))
           + (select count(*) from public.opportunities where vendor_id in ('${WX}','${W1}'))
           + (select count(*) from public.meeting_notes where vendor_id in ('${WX}','${W1}'))
           + (select count(*) from public.expenses where vendor_id in ('${WX}','${W1}')) as r`)).r == 0);
ok("dupes are archived (reversible), never deleted",
  (await q1(`select count(*)::int as r from public.vendors where id in ('${WX}','${W1}') and status = 'archived' and archived_at is not null`)).r === 2);
ok("kept vendor absorbed the dupe's POC (Sandy) into its blank field",
  (await q1(`select poc_name as r from public.vendors where id = '${WE}'`)).r === "Sandy");
ok("archived dupes stop matching in similar_vendors (guard won't block their name's reuse against them)",
  (await db.query(`select * from public.similar_vendors('Wine Xpress')`)).rows.every((r) => r.id === WE || r.name === "Wine Express"));
ok("merge refuses keep-in-dupes",
  await db.query(`select public.merge_vendors('${WE}', array['${WE}']::uuid[])`).then(() => false).catch((e) => /keep id is in the dupe list/.test(e.message)));
await db.exec(`insert into public.vendors (id, name, tenant_id, confirmed_distinct) values
  ('33333333-0000-0000-0000-000000000001', 'Tenant A Cafe', '00000000-0000-0000-0000-000000000001', true),
  ('33333333-0000-0000-0000-000000000002', 'Tenant B Bistro', '00000000-0000-0000-0000-000000000002', true);`);
ok("merge refuses a cross-tenant dupe (SECURITY DEFINER runs above RLS — tenancy enforced in-function)",
  await db.query(`select public.merge_vendors('33333333-0000-0000-0000-000000000001', array['33333333-0000-0000-0000-000000000002']::uuid[])`)
    .then(() => false).catch((e) => /cross-tenant/.test(e.message)));

// ── 5b · dupe-pair report (drives the admin "Possible duplicates" panel) ────────────────────────
await db.exec(`insert into public.vendors (id, name, confirmed_distinct) values
  ('22222222-0000-0000-0000-000000000001', 'Greenville Grocer', true),
  ('22222222-0000-0000-0000-000000000002', 'Greenville Grocers', true);`);
const pairs = (await db.query(`select a_name, b_name, sim from public.vendor_dupe_candidates()`)).rows;
ok("dupe report surfaces the Grocer/Grocers pair once, strongest first",
  pairs.length >= 1 && pairs.some((p) => /Grocer/.test(p.a_name) && /Grocers?/.test(p.b_name)), pairs);
ok("dupe report excludes archived vendors (the merged WineXpress family is gone from it)",
  pairs.every((p) => !/Xpress|XPress/i.test(p.a_name) && !/Xpress/i.test(p.b_name)), pairs);

// ── 6 · the perf ride-along ─────────────────────────────────────────────────────────────────────
ok("todos assignee partial index exists",
  (await q1(`select count(*)::int as r from pg_indexes where indexname = 'todos_assignee_open_idx'`)).r === 1);

console.log(`VENDOR CONTRACT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
