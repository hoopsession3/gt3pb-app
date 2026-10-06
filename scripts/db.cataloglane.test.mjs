// THE CATALOG IN THE BUSINESS LANE — 0352, against a real Postgres.
//
// The settings-by-category round (2026-10-06) gave what the business sells a section of its own, the
// Catalog, beside Money. A section is reached from its lane's row of tabs, and the lanes are rows of
// work_streams (0159), so 0352 puts 'catalog' into the Business lane right after 'money'. Held here:
// the table made by its own migration and held to production's columns; the lane as production holds
// it; where 'catalog' lands, for the founding lane and for a tenant who reshaped theirs without Money;
// that nothing else moves; that a second run adds nothing; and that the client's stand-in lanes
// (lib/streams DEFAULT_STREAMS) say what the live rows now say.
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
const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const mig = (f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8");

await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$ select '${T1}'::uuid $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin if new.tenant_id is null then new.tenant_id := public.effective_tenant(); end if; return new; end $$;
  create table public.changelog (id uuid primary key default gen_random_uuid(), title text, category text, area text, summary text, shipped_on date, highlight boolean default false);
  create table public.schema_migrations (version text primary key, seq int not null, applied_at timestamptz, recorded_at timestamptz not null default now(), applied_by uuid, applied_count int not null default 1, evidence text not null default 'stamped', note text);
  create or replace function public.record_migration(p_version text, p_note text default null) returns public.schema_migrations language plpgsql as $$
  declare r public.schema_migrations; begin
    insert into public.schema_migrations (version, seq, applied_at, note) values (p_version, substring(p_version from '^[0-9]+')::int, now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 returning * into r; return r; end $$;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T1}'), ('${T2}');
  create table public.profiles (id uuid primary key default gen_random_uuid(), display_name text);
`);

// ── 0 · the table, made the way production made it ─────────────────────────────────────────────
await db.exec(mig("0159_work_streams.sql"));
// A lane's icon key came later (the lane icons round); production has it last.
await db.exec(`alter table public.work_streams add column if not exists icon text;`);
const snap = JSON.parse(readFileSync(join(ROOT, "supabase/schema.columns.json"), "utf8"));
const have = (await rows(`select attname from pg_attribute where attrelid = 'public.work_streams'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname);
ok("before 0352: work_streams has production's columns, in production's order", JSON.stringify(have) === JSON.stringify(snap.work_streams), { have, prod: snap.work_streams });

// The lanes as production holds them: 0161, 0167, 0253, 0254 and 0259 reshaped the seed's sections
// into what DEFAULT_STREAMS listed before this round — Business leading with the calendar and Notes.
await db.exec(`
  update public.work_streams set sections = '{prep,now,driver}' where key = 'service';
  update public.work_streams set sections = '{plan,prep}' where key = 'events';
  update public.work_streams set sections = '{brew,garage}' where key = 'production';
  update public.work_streams set sections = '{plan,notes,money,customers,team}' where key = 'business';
`);
// A second tenant who reshaped their Business lane without Money.
await db.query(`insert into public.work_streams (tenant_id, key, label, sections, sort) values ($1, 'business', 'Business', '{plan,customers}', 5), ($1, 'service', 'Service', '{now}', 1)`, [T2]);
const lane = async (t, k) => (await q1(`select sections from public.work_streams where tenant_id = $1 and key = $2`, [t, k]))?.sections;
const others = async () => JSON.stringify(await rows(`select tenant_id, key, sections from public.work_streams where key <> 'business' order by tenant_id, key`));
const othersBefore = await others();
ok("before 0352: no lane has the Catalog", (await q1(`select count(*)::int as n from public.work_streams where 'catalog' = any(sections)`)).n === 0);

// ── 1 · 0352 ───────────────────────────────────────────────────────────────────────────────────
await db.exec(mig("0352_catalog_lane.sql"));
ok("0352: the founding Business lane has the Catalog right after Money, and nothing else moved in it",
  JSON.stringify(await lane(T1, "business")) === JSON.stringify(["plan", "notes", "money", "catalog", "customers", "team"]), await lane(T1, "business"));
ok("0352: a Business lane reshaped without Money gains the Catalog at its end, not nowhere",
  JSON.stringify(await lane(T2, "business")) === JSON.stringify(["plan", "customers", "catalog"]), await lane(T2, "business"));
ok("0352: every other lane is untouched", (await others()) === othersBefore);
ok("0352: it says what changed, once, and records itself",
  (await q1(`select count(*)::int as n from public.changelog where title = 'Settings by category, and a Catalog for what we sell'`)).n === 1
  && (await q1(`select applied_count from public.schema_migrations where version = '0352_catalog_lane'`))?.applied_count === 1);

// ── 2 · a second run ───────────────────────────────────────────────────────────────────────────
await db.exec(mig("0352_catalog_lane.sql"));
ok("0352 again: no lane gains a second Catalog, and the changelog keeps one line",
  JSON.stringify(await lane(T1, "business")) === JSON.stringify(["plan", "notes", "money", "catalog", "customers", "team"])
  && JSON.stringify(await lane(T2, "business")) === JSON.stringify(["plan", "customers", "catalog"])
  && (await q1(`select count(*)::int as n from public.changelog where title = 'Settings by category, and a Catalog for what we sell'`)).n === 1
  && (await q1(`select applied_count from public.schema_migrations where version = '0352_catalog_lane'`))?.applied_count === 2);

// ── 3 · the client's stand-in says the same ────────────────────────────────────────────────────
const streams = readFileSync(join(ROOT, "lib/streams.ts"), "utf8");
const biz = /key: "business"[^\n]*sections: \[([^\]]*)\]/.exec(streams)?.[1]?.match(/"([a-z]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
ok("lib/streams: DEFAULT_STREAMS' Business lane is the live one — the stand-in drawn before the table answers does not hide the Catalog",
  JSON.stringify(biz) === JSON.stringify(await lane(T1, "business")), biz);

console.log(`THE CATALOG IN THE BUSINESS LANE (0352): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
