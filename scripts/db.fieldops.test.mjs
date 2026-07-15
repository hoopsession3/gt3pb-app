// FIELD-OPS MERGE CONTRACT — the acceptance tests for the events+stops physical merge (0222/0223).
// Same harness philosophy as db.test.mjs: an in-process WASM Postgres (PGlite), a fixture that stubs
// ONLY what Supabase provides at runtime, table shapes mirroring the LIVE prod columns (pulled from
// information_schema, not guessed from migrations), and the MIGRATIONS UNDER TEST loaded verbatim
// from their real files. If these pass, the merge machine — backfill, mirrors, spine sync — is
// behaving to contract; the same file re-verifies every later phase.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); }
};

const db = new PGlite();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];

// ── platform stubs (what Supabase provides at runtime) ──────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon; create role authenticated;
  grant usage on schema auth, public to anon, authenticated;
  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('00000000-0000-0000-0000-000000000001');
  create table public.vendors (id uuid primary key default gen_random_uuid());
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create or replace function public.effective_tenant() returns uuid language sql stable as $$
    select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create or replace function public.stamp_tenant() returns trigger language plpgsql as $$
    begin new.tenant_id := coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid); return new; end $$;
`);

// ── events + stops, mirroring the LIVE prod column lists exactly ────────────────────────────────
await db.exec(`
  create table public.events (
    id uuid primary key default gen_random_uuid(),
    title text not null, type text, day date, start_time text, end_time text, location_text text,
    member_only boolean default false, capacity int, claimed int default 0, going_count int default 0,
    blurb text, sort int default 0, day_label text, archetype text, rig text,
    menu_nitro boolean default false, menu_nature_aid boolean default false, menu_salted_maple boolean default false,
    menu_bottles boolean default false, menu_broth boolean default false,
    power_available boolean default false, water_available boolean default false,
    expected_attendance int, duration_hrs numeric, staff_count int, is_live boolean default false,
    state text, county text, archived_at timestamptz, vendor_id uuid references public.vendors(id),
    tenant_id uuid default '00000000-0000-0000-0000-000000000001', category text, plan_days int,
    outlook_event_id text, outlook_synced_at timestamptz, stage text, default_buffer_min int, completed_at timestamptz
  );
  create table public.stops (
    id uuid primary key default gen_random_uuid(),
    name text not null, location_text text, lat double precision, lng double precision,
    starts_at timestamptz, ends_at timestamptz, status text, note text, menu_tier text, sort int default 0,
    when_label text, time_label text, tag_label text, notes text, address text,
    -- poc_name/poc_phone/poc_email/service_dates: present here because this stub is prod state as
    -- of ~0221 (right before 0222 applies, which still backfills them into field_ops from here) —
    -- they aren't dropped until 0240, applied near the bottom of this file (section 9), matching
    -- their real chronological position in migration history. Don't remove them from this stub.
    poc_name text, poc_phone text, poc_email text, service_dates text, archived_at timestamptz,
    vendor_id uuid references public.vendors(id), tenant_id uuid default '00000000-0000-0000-0000-000000000001',
    plan_days int, rig text, power_available boolean default false, water_available boolean default false,
    menu_nitro boolean default false, menu_nature_aid boolean default false, menu_salted_maple boolean default false,
    menu_bottles boolean default false, menu_broth boolean default false,
    default_buffer_min int, completed_at timestamptz,
    order_ahead_enabled boolean default false, pickup_enabled boolean default false, order_ahead_lead_min int
  );
`);

// ── the 21 dependents, minimal shapes (id + their real parent columns) ──────────────────────────
const DUAL = ["brew_batch_links","brew_batches","content_items","content_links","event_approvals",
  "event_menu_items","event_schedule_items","event_staff","incident_log",
  "inventory_ledger","meeting_notes"];
const EVENT_ONLY = ["documents","event_sales","expenses","rsvps","todos"];
for (const t of DUAL) await db.exec(
  `create table public.${t} (id uuid primary key default gen_random_uuid(),
     event_id uuid references public.events(id) on delete cascade,
     stop_id uuid references public.stops(id) on delete cascade);`);
for (const t of EVENT_ONLY) await db.exec(
  `create table public.${t} (id uuid primary key default gen_random_uuid(),
     event_id uuid references public.events(id) on delete cascade);`);
// Prod-fidelity shapes the panel demanded (the minimal shapes hid a real trigger bug):
// event_tasks carries the 0164 one-owner 4-way check; orders mixes FK actions (0024 NO ACTION /
// 0219 SET NULL); event_economics/event_ops/stop_ops key the PARENT as their primary key.
await db.exec(`
  create table public.event_tasks (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade,
    stop_id uuid references public.stops(id) on delete cascade,
    meeting_note_id uuid, goal_id uuid,
    constraint event_tasks_one_owner check (
      ((event_id is not null)::int + (stop_id is not null)::int +
       (meeting_note_id is not null)::int + (goal_id is not null)::int) = 1));
  create table public.orders (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id),
    stop_id uuid references public.stops(id) on delete set null);
  create table public.event_economics (event_id uuid primary key references public.events(id) on delete cascade);
  create table public.event_ops (event_id uuid primary key references public.events(id) on delete cascade);
  create table public.stop_ops (stop_id uuid primary key references public.stops(id) on delete cascade);
`);
// Prod trigger population + the 0220 view, so 0222 exercises the drop-view path and BEFORE/AFTER order.
await db.exec(`
  create trigger stamp_tenant_tg before insert on public.events for each row execute function public.stamp_tenant();
  create trigger stamp_tenant_tg before insert on public.stops for each row execute function public.stamp_tenant();
  create view public.field_ops as select id, 'event'::text as kind from public.events
    union all select id, 'stop' from public.stops;
`);

// ── pre-existing rows (the backfill population) ─────────────────────────────────────────────────
const EV = "eeeeeeee-0000-0000-0000-000000000001";
const ST = "ssssssss-0000-0000-0000-000000000001".replace(/s/g, "5");
await db.exec(`
  insert into public.events (id, title, day, category, is_live) values ('${EV}', 'Gratitude Market', '2026-07-31', 'event', false);
  insert into public.stops (id, name, starts_at, status) values ('${ST}', 'WineXpress', '2026-07-18T15:00:00Z', 'upcoming');
  insert into public.event_tasks (event_id) values ('${EV}');
  insert into public.orders (stop_id) values ('${ST}');
  insert into public.event_sales (event_id) values ('${EV}');
  insert into public.stop_ops (stop_id) values ('${ST}');
`);

// ── APPLY THE REAL MIGRATIONS ───────────────────────────────────────────────────────────────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0222_field_ops_table.sql"), "utf8"));
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0223_field_op_spine.sql"), "utf8"));

// ── 1 · backfill: every source row present, UUIDs preserved, kinds right ────────────────────────
ok("backfill count = events + stops",
  (await q1(`select (select count(*)::int from public.field_ops) =
                    (select count(*)::int from public.events) + (select count(*)::int from public.stops) as r`)).r === true);
ok("event UUID preserved with kind/name mapped",
  (await q1(`select kind || '|' || name as r from public.field_ops where id = '${EV}'`)).r === "event|Gratitude Market");
ok("stop UUID preserved with kind/name mapped",
  (await q1(`select kind || '|' || name as r from public.field_ops where id = '${ST}'`)).r === "stop|WineXpress");

// ── 2 · mirrors: insert / update / delete flow through, both kinds ──────────────────────────────
await db.exec(`insert into public.events (id, title, day) values ('eeeeeeee-0000-0000-0000-000000000002', 'Pop-up', '2026-08-02');`);
ok("event insert mirrors", (await q1(`select name as r from public.field_ops where id = 'eeeeeeee-0000-0000-0000-000000000002'`))?.r === "Pop-up");
await db.exec(`update public.events set title = 'Pop-up · Midtown', is_live = true where id = 'eeeeeeee-0000-0000-0000-000000000002';`);
ok("event update mirrors (rename + live)",
  (await q1(`select name || '|' || is_live::text as r from public.field_ops where id = 'eeeeeeee-0000-0000-0000-000000000002'`)).r === "Pop-up · Midtown|true");
await db.exec(`delete from public.events where id = 'eeeeeeee-0000-0000-0000-000000000002';`);
ok("event delete mirrors", (await q1(`select count(*)::int as r from public.field_ops where id = 'eeeeeeee-0000-0000-0000-000000000002'`)).r === 0);

await db.exec(`insert into public.stops (id, name, starts_at) values ('55555555-0000-0000-0000-000000000002', 'Office Row', '2026-07-20T13:00:00Z');`);
ok("stop insert mirrors", (await q1(`select name as r from public.field_ops where id = '55555555-0000-0000-0000-000000000002'`))?.r === "Office Row");
await db.exec(`update public.stops set starts_at = '2026-07-20T16:51:00Z' where id = '55555555-0000-0000-0000-000000000002';`);
ok("stop time update mirrors",
  (await q1(`select starts_at = '2026-07-20T16:51:00Z'::timestamptz as r from public.field_ops where id = '55555555-0000-0000-0000-000000000002'`)).r === true);
await db.exec(`delete from public.stops where id = '55555555-0000-0000-0000-000000000002';`);
ok("stop delete mirrors", (await q1(`select count(*)::int as r from public.field_ops where id = '55555555-0000-0000-0000-000000000002'`)).r === 0);

// ── 3 · spine: backfilled + auto-synced on old-writer inserts and re-parents ────────────────────
ok("spine column landed on all 21 dependents",
  (await q1(`select count(*)::int as r from information_schema.columns where table_schema = 'public' and column_name = 'field_op_id'`)).r === 21);
ok("pre-existing event_tasks backfilled", (await q1(`select field_op_id::text as r from public.event_tasks limit 1`)).r === EV);
ok("pre-existing stop order backfilled", (await q1(`select field_op_id::text as r from public.orders limit 1`)).r === ST);
ok("pre-existing stop_ops backfilled", (await q1(`select field_op_id::text as r from public.stop_ops limit 1`)).r === ST);
await db.exec(`insert into public.event_tasks (id, stop_id) values ('aaaaaaaa-0000-0000-0000-000000000009', '${ST}');`);
ok("old-writer insert auto-fills the spine",
  (await q1(`select field_op_id::text as r from public.event_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000009'`)).r === ST);
await db.exec(`update public.event_tasks set stop_id = null, event_id = '${EV}' where id = 'aaaaaaaa-0000-0000-0000-000000000009';`);
ok("re-parent re-derives the spine",
  (await q1(`select field_op_id::text as r from public.event_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000009'`)).r === EV);

// ── 4 · the panel's cases: unlink clears, re-parent-to-goal clears, set-null delete path ────────
await db.exec(`insert into public.content_items (id, event_id) values ('cccccccc-0000-0000-0000-000000000001', '${EV}');`);
await db.exec(`update public.content_items set event_id = null where id = 'cccccccc-0000-0000-0000-000000000001';`);
ok("unlink CLEARS the spine (Studio's {event_id: null})",
  (await q1(`select field_op_id is null as r from public.content_items where id = 'cccccccc-0000-0000-0000-000000000001'`)).r === true);
await db.exec(`update public.event_tasks set event_id = null, goal_id = gen_random_uuid() where id = 'aaaaaaaa-0000-0000-0000-000000000009';`);
ok("re-parent event→goal clears the spine",
  (await q1(`select field_op_id is null as r from public.event_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000009'`)).r === true);
ok("pending 0224 one-owner would hold on every event_tasks row",
  (await q1(`select count(*)::int as r from public.event_tasks where
     ((field_op_id is not null)::int + (meeting_note_id is not null)::int + (goal_id is not null)::int) <> 1`)).r === 0);
await db.exec(`
  insert into public.stops (id, name) values ('55555555-0000-0000-0000-000000000003', 'SetNull Stop');
  insert into public.orders (id, stop_id) values ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003');
  delete from public.stops where id = '55555555-0000-0000-0000-000000000003';`);
ok("stop delete (SET NULL FK) clears both parent and spine, no dangling ref",
  (await q1(`select (stop_id is null and field_op_id is null) as r from public.orders where id = 'bbbbbbbb-0000-0000-0000-000000000001'`)).r === true);

// ── 5 · drift: the nightly invariant, looped over EVERY spined table, both drift classes ────────
const SPINED = [...DUAL, "event_tasks", "orders", ...EVENT_ONLY, "event_economics", "event_ops", "stop_ops"];
for (const t of SPINED) {
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}'`)).rows.map((r) => r.column_name);
  const e = cols.includes("event_id") ? "event_id" : "null::uuid";
  const st = cols.includes("stop_id") ? "stop_id" : "null::uuid";
  const bad = (await q1(`select count(*)::int as r from public.${t}
    where (coalesce(${e}, ${st}) is not null and field_op_id is distinct from coalesce(${e}, ${st}))
       or (field_op_id is not null and coalesce(${e}, ${st}) is null)`)).r;
  ok(`zero drift on ${t} (both classes)`, bad === 0, bad);
}

// ── 6 · all_tasks v2 (0225): the ONE task read-view, enriched for My Day off the spine ──────────
// Fixture fidelity: give event_tasks/todos their real read columns (lax nullability — the view
// doesn't depend on it), a titled meeting_notes, and a goals table, then prove the REAL 0225
// replaces the REAL 0210 baseline legally (append-only) and carries the context My Day renders.
await db.exec(`
  alter table public.event_tasks
    add column label text, add column assignee uuid, add column due_at timestamptz,
    add column done boolean not null default false, add column done_at timestamptz,
    add column created_at timestamptz not null default now(), add column critical boolean not null default false,
    add column section text, add column warn boolean not null default false, add column sort int not null default 0;
  alter table public.todos
    add column title text, add column assignee uuid, add column due_on date,
    add column done boolean not null default false, add column done_at timestamptz,
    add column created_at timestamptz not null default now(), add column category text, add column meeting_note_id uuid;
  alter table public.meeting_notes add column title text;
  create table public.goals (id uuid primary key default gen_random_uuid(), title text);
`);
// The LIVE baseline, verbatim from 0210 (nothing later redefines all_tasks; prod viewdef is
// re-verified against this before 0225 is applied there).
await db.exec(`
  create or replace view public.all_tasks with (security_invoker = on) as
    select 'event'::text as source, id, label as title, assignee, due_at::date as due,
           done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id
    from public.event_tasks
    union all
    select 'todo', id, title, assignee, due_on as due,
           done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id
    from public.todos;
`);
let v2ok = true;
try { await db.exec(readFileSync(join(ROOT, "supabase/migrations/0225_all_tasks_v2.sql"), "utf8")); }
catch (e) { v2ok = false; console.log(`  ✗ 0225 apply threw → ${e.message}`); }
ok("0225 replaces the 0210 baseline legally (append-only column contract)", v2ok);
await db.exec(`
  insert into public.meeting_notes (id, title) values ('dddddddd-0000-0000-0000-000000000001', 'Monday sync');
  insert into public.goals (id, title) values ('99999999-0000-0000-0000-000000000001', 'July revenue');
  insert into public.event_tasks (id, event_id, label, due_at, critical, warn, sort)
    values ('aaaaaaaa-0000-0000-0000-000000000010', '${EV}', 'Order bottles', '2026-07-30T18:00:00Z', true, true, 3);
  insert into public.event_tasks (id, stop_id, label)
    values ('aaaaaaaa-0000-0000-0000-000000000011', '${ST}', 'Pack signage');
  insert into public.event_tasks (id, meeting_note_id, label)
    values ('aaaaaaaa-0000-0000-0000-000000000012', 'dddddddd-0000-0000-0000-000000000001', 'Send recap');
  insert into public.event_tasks (id, goal_id, label)
    values ('aaaaaaaa-0000-0000-0000-000000000013', '99999999-0000-0000-0000-000000000001', 'Push packs');
  insert into public.todos (id, event_id, title, due_on, category)
    values ('cccccccc-0000-0000-0000-000000000002', '${EV}', 'Call the venue', '2026-07-16', 'Events');
`);
ok("WorkloadBoard read is untouched (original columns, original types)",
  (await q1(`select (assignee is null and due = '2026-07-30' and done = false) as r
             from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000010'`)).r === true);
ok("event task carries op context + INTRADAY due_at (not just the date)",
  (await q1(`select op_kind || '|' || op_name || '|' || (due_at = '2026-07-30T18:00:00Z'::timestamptz)::text || '|' || warn::text || '|' || sort::text as r
             from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000010'`)).r === "event|Gratitude Market|true|true|3");
ok("STOP task finally carries its stop's name off the spine",
  (await q1(`select op_kind || '|' || op_name as r from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000011'`)).r === "stop|WineXpress");
ok("stop context ships the raw instant for client-side localization (no UTC date cast)",
  (await q1(`select (op_day is null and op_starts_at = '2026-07-18T15:00:00Z'::timestamptz) as r
             from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000011'`)).r === true);
ok("note-owned task carries meeting_note_title",
  (await q1(`select meeting_note_title as r from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000012'`)).r === "Monday sync");
ok("goal-owned task carries goal_title",
  (await q1(`select goal_title as r from public.all_tasks where id = 'aaaaaaaa-0000-0000-0000-000000000013'`)).r === "July revenue");
ok("todo leg: source/due/category intact, critical stays false, spine context rides along",
  (await q1(`select source || '|' || due::text || '|' || category || '|' || critical::text || '|' || op_name as r
             from public.all_tasks where id = 'cccccccc-0000-0000-0000-000000000002'`)).r === "todo|2026-07-16|Events|false|Gratitude Market");
ok("view keeps security_invoker (RLS of the querying user, not the owner)",
  (await q1(`select 'security_invoker=on' = any(reloptions) as r from pg_class where relname = 'all_tasks'`)).r === true);

// ── 7 · the drift RPC (0227): the nightly watcher's endpoint returns the same four zeros ────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0227_field_ops_drift_fn.sql"), "utf8"));
const drift = (await db.query(`select chk, n::int as n from public.field_ops_drift() order by chk`)).rows;
ok("field_ops_drift() returns exactly the four soak checks, all zero on a clean spine",
  drift.length === 4 && drift.every((r) => r.n === 0), drift);

// ── 8 · 0233: public visibility decided in one place (generated on both tables + the door) ──────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0233_public_visibility.sql"), "utf8"));
ok("plain event is public on BOTH tables",
  (await q1(`select (select is_public from public.events where id = '${EV}') and
                    (select is_public from public.field_ops where id = '${EV}') as r`)).r === true);
ok("unarchived stop is public on the spine",
  (await q1(`select is_public as r from public.field_ops where id = '${ST}'`)).r === true);
const PB = "eeeeeeee-0000-0000-0000-000000000233";
await db.exec(`insert into public.events (id, title, day, category, archetype) values ('${PB}', 'Smith wedding', '2026-08-08', 'event', 'private_booking')`);
ok("private_booking is NOT public — events table",
  (await q1(`select is_public as r from public.events where id = '${PB}'`)).r === false);
ok("private_booking is NOT public — mirrored spine agrees (generated, not copied)",
  (await q1(`select is_public as r from public.field_ops where id = '${PB}'`)).r === false);
const OPS = "eeeeeeee-0000-0000-0000-000000000234";
await db.exec(`insert into public.events (id, title, day, category) values ('${OPS}', 'Deep clean', '2026-08-09', 'ops')`);
ok("internal ops event is NOT public (both tables)",
  (await q1(`select (select not is_public from public.events where id = '${OPS}') and
                    (select not is_public from public.field_ops where id = '${OPS}') as r`)).r === true);
await db.exec(`update public.stops set archived_at = now() where id = '${ST}'`);
ok("archiving a stop flips is_public off through the mirror",
  (await q1(`select is_public as r from public.field_ops where id = '${ST}'`)).r === false);
await db.exec(`update public.stops set archived_at = null where id = '${ST}'`);
ok("un-archiving flips it back (pure function of the row)",
  (await q1(`select is_public as r from public.field_ops where id = '${ST}'`)).r === true);
ok("the DOOR: select policy on events now gates on is_public (guests) or is_staff",
  (await q1(`select qual like '%is_public%' and qual like '%is_staff%' as r from pg_policies
             where tablename = 'events' and policyname = 'public read events'`)).r === true);
ok("the MIRROR's door too: field_ops read policy gates on is_public or is_staff (panel: 0222 shipped using(true))",
  (await q1(`select qual like '%is_public%' and qual like '%is_staff%' as r from pg_policies
             where tablename = 'field_ops' and policyname = 'field ops read'`)).r === true);
ok("no drift between the two computed columns anywhere",
  (await q1(`select count(*)::int as r from public.field_ops fo join public.events e on e.id = fo.id
             where fo.is_public <> e.is_public`)).r === 0);

// ── 9 · 0240: stop contact cleanup — dead poc_*/service_dates columns dropped from BOTH tables,
//      mirror trigger still functions cleanly without them ─────────────────────────────────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0240_stop_contact_cleanup.sql"), "utf8"));
ok("poc_name/poc_phone/poc_email/service_dates gone from stops",
  (await q1(`select count(*)::int as r from information_schema.columns
             where table_schema='public' and table_name='stops'
               and column_name in ('poc_name','poc_phone','poc_email','service_dates')`)).r === 0);
ok("poc_name/poc_phone/poc_email/service_dates gone from field_ops",
  (await q1(`select count(*)::int as r from information_schema.columns
             where table_schema='public' and table_name='field_ops'
               and column_name in ('poc_name','poc_phone','poc_email','service_dates')`)).r === 0);
await db.exec(`insert into public.stops (id, name, starts_at) values ('55555555-0000-0000-0000-000000000004', 'Post-0240 Stop', '2026-08-01T12:00:00Z');`);
ok("mirror still fires cleanly post-0240 (insert)",
  (await q1(`select name as r from public.field_ops where id = '55555555-0000-0000-0000-000000000004'`))?.r === "Post-0240 Stop");
await db.exec(`update public.stops set name = 'Renamed Stop' where id = '55555555-0000-0000-0000-000000000004';`);
ok("mirror still fires cleanly post-0240 (update)",
  (await q1(`select name as r from public.field_ops where id = '55555555-0000-0000-0000-000000000004'`))?.r === "Renamed Stop");
await db.exec(`delete from public.stops where id = '55555555-0000-0000-0000-000000000004';`);
ok("mirror still fires cleanly post-0240 (delete)",
  (await q1(`select count(*)::int as r from public.field_ops where id = '55555555-0000-0000-0000-000000000004'`)).r === 0);

console.log(`FIELD-OPS CONTRACT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
