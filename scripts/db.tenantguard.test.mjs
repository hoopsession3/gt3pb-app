// SECOND-TENANT GUARD — 0305, executed from its file.
//
// R-002's remaining 62 unscoped service-role reads are latent only because this database holds one
// tenant. The guard exists so that stops being an accident of the data: the insert that would make
// them reachable is refused until the sweep is done. What matters is that it refuses by default,
// that the refusal SAYS why, and that the deliberate override actually works — a guard nobody can
// get past when they need to is a guard someone drops.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T1 = "00000000-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.tenants (id uuid primary key default gen_random_uuid());
  create table public.inventory_items (id uuid primary key default gen_random_uuid(), name text, kind text);
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text,
    category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz, recorded_at timestamptz not null default now(),
    applied_by uuid, applied_count int not null default 1,
    evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null)
  returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1
    returning * into r; return r; end $$;
  insert into public.inventory_items (name, kind) values
    ('EVEBOT Handheld Inkjet Printer', null),
    ('UVDTF bottle labels (Jiffy Land)', null),
    ('Site plans - Webflow Business Hosting Plan', null),
    ('Yupik Organic Raw Cacao Nibs 2.2 lb', 'ingredient');
`);

// The guard has to survive the FIRST tenant existing — that is the whole point.
await db.exec(`insert into public.tenants (id) values ('${T1}');`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0305_second_tenant_guard.sql"), "utf8"));

const refusal = await raises(`insert into public.tenants (id) values (gen_random_uuid());`);
ok("guard: a second tenant is refused", refusal !== null, refusal);
ok("guard: and the refusal names R-002's unfinished sweep rather than just saying no",
  !!refusal && /second tenant cannot be created/i.test(refusal), refusal);
ok("guard: only one tenant made it in",
  Number((await q1(`select count(*) c from public.tenants`))?.c) === 1);

// The deliberate path. Without it the sweep's own tests could never build a two-tenant fixture,
// and a guard that blocks the work it is protecting gets deleted rather than respected.
const viaHatch = await raises(`begin; set local gt3.allow_second_tenant = 'on';
  insert into public.tenants (id) values (gen_random_uuid()); commit;`);
ok("guard: the deliberate override lets one through", viaHatch === null, viaHatch);
ok("guard: and now there are two", Number((await q1(`select count(*) c from public.tenants`))?.c) === 2);
// set local ends with the transaction; the next insert must be refused again.
ok("guard: the hatch does not stay open after the transaction",
  (await raises(`insert into public.tenants (id) values (gen_random_uuid());`)) !== null);

// ── the two shelf items ─────────────────────────────────────────────────────────────────────────
const kind = async (n) => (await q1(`select kind from public.inventory_items where name = '${n}'`))?.kind;
ok("kinds: the inkjet printer is equipment", await kind("EVEBOT Handheld Inkjet Printer") === "equipment");
ok("kinds: the bottle labels are packaging", await kind("UVDTF bottle labels (Jiffy Land)") === "packaging");
// The one deliberately left alone. A migration that clears a gap by mislabelling the row is worse
// than the gap: the shelf would then claim a monthly hosting plan is a thing you can count.
ok("kinds: the Webflow hosting plan is LEFT unclassified, not filed as stock",
  (await kind("Site plans - Webflow Business Hosting Plan")) === null);
ok("kinds: an already-classified item is untouched",
  await kind("Yupik Organic Raw Cacao Nibs 2.2 lb") === "ingredient");

ok("0305 recorded itself in the ledger",
  (await q1(`select evidence from public.schema_migrations where version = '0305_second_tenant_guard'`))?.evidence === "stamped");

console.log(`SECOND-TENANT GUARD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
