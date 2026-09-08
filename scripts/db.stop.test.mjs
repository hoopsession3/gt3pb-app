// A STOP IS A VISIT, NOT A NAME — 0315, executed from its file.
//
// A CAVEAT I AM WRITING DOWN RATHER THAN HIDING: this fixture was built from the migration history
// (0001 + every `alter table public.stops`, minus what 0195 and 0240 dropped), NOT from a live
// information_schema read — the browser session that reaches production dropped while this was
// being written. That is the exact shortcut that produced a query against events.recap earlier
// today, on a column the live table does not have. So the column set here is a HYPOTHESIS until it
// is checked against production, and the check is the last thing before this ships.
//
// IT CAUGHT ONE: stops.day_label. The migration history has an `add column ... day_label` that
// reads as if it landed on stops; production says otherwise. Removed from both the view and this
// fixture before applying — which is the whole reason for writing the caveat down instead of
// hoping.
//
// What that means concretely: PGlite passing proves the LOGIC is right. It does not prove the
// column names are. Those are two different claims and only one of them is tested below.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
const U1 = "00000000-0000-0000-0000-0000000000d1";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const all = async (s) => (await db.query(s)).rows;
const raises = async (s) => { try { await db.exec(s); return null; } catch (e) { return String(e.message || e); } };

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${U1}');
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('test.uid', true), ''), '')::uuid $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$
    select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;

  create table public.tenants (id uuid primary key default gen_random_uuid());
  insert into public.tenants (id) values ('${T}');
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

  -- vendors (0034 + the later status/kind alters)
  create table public.vendors (id uuid primary key default gen_random_uuid(),
    name text not null default 'New vendor', poc_name text, poc_phone text, poc_email text,
    address text, location_text text, lat double precision, lng double precision,
    service_dates text, notes text, archived_at timestamptz, sort int not null default 0,
    created_at timestamptz not null default now(), status text, kind text, vendor_type text);
  -- vendor_locations (0226) — exists, and nothing points at it. That IS the finding.
  create table public.vendor_locations (id uuid primary key default gen_random_uuid(),
    vendor_id uuid not null references public.vendors(id) on delete cascade,
    label text not null default 'Main', address text, location_text text,
    lat double precision, lng double precision, is_primary boolean not null default false,
    sort int not null default 0, archived_at timestamptz);

  -- stops: 0001 + surviving alters. crew_brief/dress_code/recap left in 0195; poc_*/service_dates
  -- dropped in 0240. Both absences are deliberate here — a fixture carrying them would pass while
  -- production failed.
  create table public.stops (
    id uuid primary key default gen_random_uuid(), name text not null, location_text text,
    lat double precision, lng double precision, starts_at timestamptz, ends_at timestamptz,
    status text not null default 'upcoming' check (status in ('live','upcoming','done')),
    note text, menu_tier text, sort int not null default 0,
    address text, archived_at timestamptz, completed_at timestamptz,
    -- no day_label: information_schema says production's stops has none, and a fixture that
    -- carries a column the real table lacks is a test that lies.
    when_label text, time_label text, default_buffer_min int, plan_days int, notes text,
    order_ahead_enabled boolean, pickup_enabled boolean, order_ahead_lead_min int,
    power_available boolean, water_available boolean, rig text, tag_label text,
    menu_nitro boolean, menu_nature_aid boolean, menu_salted_maple boolean,
    menu_bottles boolean, menu_broth boolean,
    vendor_id uuid references public.vendors(id) on delete set null);

  create table public.stop_ops (stop_id uuid primary key references public.stops(id) on delete cascade,
    tenant_id uuid default '${T}', crew_brief text, dress_code text, recap text,
    updated_at timestamptz not null default now());
  create table public.live_status (id int primary key default 1 check (id = 1),
    current_stop_id uuid references public.stops(id), is_live boolean not null default false);

  create table public.events (id uuid primary key default gen_random_uuid(),
    archived_at timestamptz, vendor_id uuid references public.vendors(id));
  create table public.event_tasks (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade, label text,
    critical boolean default false, done boolean default false);
  create table public.event_staff (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade);
  create table public.event_approvals (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade);
  create table public.event_schedule_items (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade);
  create table public.event_menu_items (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade);
  create table public.incident_log (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete cascade);
  create table public.brew_batches (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete set null);
  create table public.content_items (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete set null);
  create table public.orders (id uuid primary key default gen_random_uuid(),
    stop_id uuid references public.stops(id) on delete set null, total_cents int not null default 0);
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0315_a_stop_is_a_visit_not_a_name.sql"), "utf8"));
// 0316 replaces v_stop_gaps to carry canonical_name out to the row. Executed here, in order,
// because the assertions below are about what the app actually reads — and what the app reads is
// the migrations applied end to end, not the one that introduced the view.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0316_a_list_that_says_what_it_found.sql"), "utf8"));
console.log("0315 + 0316 executed against a real Postgres.\n");
await db.exec(`select set_config('test.uid','${U1}',false)`);

const mkStop = async (cols) => (await db.query(
  `insert into public.stops (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`)).rows[0].id;
const gapsFor = async (id) => (await all(`select gap from public.v_stop_gaps where stop_id='${id}' order by gap`)).map((r) => r.gap);

// ── 1) SIXTEEN TABLES, ONE ROW ─────────────────────────────────────────────────────────────────
const wine = (await db.query(`insert into public.vendors (name, address, location_text, lat, lng, status)
  values ('Wine Express', '12 Main St, Greenville SC', '12 Main St', 34.85, -82.39, 'confirmed') returning id`)).rows[0].id;
const s1 = await mkStop({
  name: `'Wine Express'`, vendor_id: `'${wine}'`, address: `'12 Main St, Greenville SC'`,
  lat: `34.85`, lng: `-82.39`, starts_at: `now() + interval '3 days'`, status: `'upcoming'`,
});
await db.exec(`insert into public.stop_ops (stop_id, crew_brief) values ('${s1}', 'Park behind the tasting room')`);
await db.exec(`insert into public.event_tasks (stop_id, label, critical, done) values
  ('${s1}','Ice',true,false), ('${s1}','Cups',false,true), ('${s1}','Signage',false,false)`);
await db.exec(`insert into public.event_staff (stop_id) values ('${s1}'), ('${s1}')`);
await db.exec(`insert into public.event_menu_items (stop_id) values ('${s1}')`);
await db.exec(`insert into public.event_schedule_items (stop_id) values ('${s1}')`);
await db.exec(`insert into public.incident_log (stop_id) values ('${s1}')`);
await db.exec(`insert into public.brew_batches (stop_id) values ('${s1}'), ('${s1}')`);
await db.exec(`insert into public.content_items (stop_id) values ('${s1}')`);
await db.exec(`insert into public.orders (stop_id, total_cents) values ('${s1}', 1200), ('${s1}', 800)`);

const r1 = await q1(`select * from public.v_stop_record where id='${s1}'`);
ok("a stop finally has a row a screen can render", !!r1);
ok("with the venue it belongs to", r1.vendor_name === "Wine Express" && r1.vendor_status === "confirmed");
ok("the crew brief from the staff-only sibling", r1.crew_brief === "Park behind the tasting room");
ok("tasks counted, done counted, open derived", Number(r1.tasks) === 3 && Number(r1.tasks_done) === 1 && Number(r1.tasks_open) === 2);
ok("critical-and-still-open counted on its own", Number(r1.tasks_critical_open) === 1);
ok("crew, menu, run of show, incidents, brews and content all on the same row",
  Number(r1.staff) === 2 && Number(r1.menu_items) === 1 && Number(r1.schedule_items) === 1
    && Number(r1.incidents) === 1 && Number(r1.brews) === 2 && Number(r1.content_items) === 1);
ok("and what it took", Number(r1.orders) === 2 && Number(r1.orders_cents) === 2000);
ok("phase reads off the clock", r1.phase === "upcoming" && Number(r1.days_away) >= 2);
ok("a stop with no satellites reads zero, not null",
  await (async () => { const b = await mkStop({ name: `'Bare'`, starts_at: `now() + interval '1 day'` });
    const x = await q1(`select tasks, staff, orders, orders_cents from public.v_stop_record where id='${b}'`);
    return [x.tasks, x.staff, x.orders, x.orders_cents].every((v) => Number(v) === 0); })());
ok("a clean upcoming linked stop has nothing to answer for", (await gapsFor(s1)).length === 0, await gapsFor(s1));

// ── 2) THE NAME QUESTION ───────────────────────────────────────────────────────────────────────
// This is the whole point of the round. Rename the venue the way the vendor editor does, and watch
// what the stop still says.
await db.exec(`update public.vendors set name = 'Wine Express Saturday' where id = '${wine}'`);
const r2 = await q1(`select name, canonical_name, name_is_stale from public.v_stop_record where id='${s1}'`);
ok("renaming the venue does NOT change the stop — that is the bug, reproduced", r2.name === "Wine Express");
ok("canonical_name says what the place is actually called now", r2.canonical_name === "Wine Express Saturday");
ok("and the row knows it is behind", r2.name_is_stale === true);
ok("which shows up as a gap, at the highest severity, because guests see it",
  (await gapsFor(s1)).includes("name_drift"));
ok("severity is high", (await q1(`select severity from public.v_stop_gaps where stop_id='${s1}' and gap='name_drift'`)).severity === "high");

// the one-tap fix
const fix = await q1(`select * from public.resync_stop_from_vendor('${s1}')`);
ok("resync reports what it changed rather than just saying done",
  fix.old_name === "Wine Express" && fix.new_name === "Wine Express Saturday", fix);
ok("the stop now matches the venue", (await q1(`select name from public.stops where id='${s1}'`)).name === "Wine Express Saturday");
ok("and the drift is gone", !(await gapsFor(s1)).includes("name_drift"));

ok("an unlinked stop is never accused of name drift — there is nothing to be behind",
  await (async () => { const u = await mkStop({ name: `'Some Corner'`, starts_at: `now() + interval '2 days'`, lat: `34.8`, lng: `-82.3` });
    return !(await gapsFor(u)).includes("name_drift"); })());
ok("resync refuses on an unlinked stop, and says what to do instead",
  /not linked to a venue/i.test(await raises(`select public.resync_stop_from_vendor(
    (select id from public.stops where name='Some Corner'))`) || ""));
await db.exec(`select set_config('test.staff','off',false)`);
ok("and a customer cannot resync anything", /Only crew/i.test(await raises(`select public.resync_stop_from_vendor('${s1}')`) || ""));
await db.exec(`select set_config('test.staff','on',false)`);

// whitespace is not drift
const ws = (await db.query(`insert into public.vendors (name) values ('  Sassafras  ') returning id`)).rows[0].id;
const wsStop = await mkStop({ name: `'Sassafras'`, vendor_id: `'${ws}'`, starts_at: `now() + interval '5 days'`, lat: `1`, lng: `1` });
ok("stray whitespace around a name is not a rename", !(await gapsFor(wsStop)).includes("name_drift"), await gapsFor(wsStop));

// ── 3) EVERY OTHER GAP, BOTH WAYS ──────────────────────────────────────────────────────────────
const noPin = await mkStop({ name: `'No Pin'`, starts_at: `now() + interval '2 days'` });
ok("a stop with no map pin is caught — directions are broken for everyone", (await gapsFor(noPin)).includes("no_pin"));
ok("a pinned stop is not", !(await gapsFor(s1)).includes("no_pin"));

const undated = await mkStop({ name: `'Someday'`, lat: `1`, lng: `1` });
ok("no date is caught", (await gapsFor(undated)).includes("no_day"));
ok("and phase says undated rather than guessing",
  (await q1(`select phase, days_away from public.v_stop_record where id='${undated}'`)).phase === "undated");
ok("days_away is null, not zero — 'today' and 'no idea' are different answers",
  (await q1(`select days_away from public.v_stop_record where id='${undated}'`)).days_away === null);

const stale = await mkStop({ name: `'Last Week'`, starts_at: `now() - interval '3 days'`, status: `'upcoming'`, lat: `1`, lng: `1` });
ok("a window that closed days ago and still reads upcoming is caught", (await gapsFor(stale)).includes("stale_status"));
// the 8-hour grace, copied from FieldOpSheet so the database agrees with the four screens
const justEnded = await mkStop({ name: `'Two Hours Ago'`, starts_at: `now() - interval '2 hours'`, status: `'upcoming'`, lat: `1`, lng: `1` });
ok("but one that started two hours ago is still TODAY, not stale — the 8-hour grace",
  !(await gapsFor(justEnded)).includes("stale_status"), await gapsFor(justEnded));
ok("and it reads as today", (await q1(`select phase from public.v_stop_record where id='${justEnded}'`)).phase === "today");
const nineHours = await mkStop({ name: `'Nine Hours Ago'`, starts_at: `now() - interval '9 hours'`, status: `'upcoming'`, lat: `1`, lng: `1` });
ok("nine hours ago is past, and stale — the grace has an edge and it is where it says it is",
  (await gapsFor(nineHours)).includes("stale_status"));

await db.exec(`insert into public.live_status (id, current_stop_id, is_live) values (1, '${stale}', true)`);
ok("a stop still flagged live after its window closed is caught — the public page points there",
  (await gapsFor(stale)).includes("live_past"));
ok("and the record says it is live", (await q1(`select is_live_now from public.v_stop_record where id='${stale}'`)).is_live_now === true);
ok("while a stop that is not live says so", (await q1(`select is_live_now from public.v_stop_record where id='${s1}'`)).is_live_now === false);

const unlinked = await mkStop({ name: `'Typed By Hand'`, starts_at: `now() + interval '4 days'`, lat: `1`, lng: `1` });
ok("an unlinked stop is flagged — typing the name again is how one place becomes three",
  (await gapsFor(unlinked)).includes("unlinked"));
ok("a linked one is not", !(await gapsFor(s1)).includes("unlinked"));

const addrDrift = await mkStop({ name: `'Wine Express Saturday'`, vendor_id: `'${wine}'`,
  address: `'99 Old Road'`, starts_at: `now() + interval '6 days'`, lat: `1`, lng: `1` });
ok("an address that disagrees with the venue's is caught", (await gapsFor(addrDrift)).includes("addr_drift"));
ok("a matching one is not", !(await gapsFor(s1)).includes("addr_drift"));
// a venue with no address on file must not accuse every stop that has one
const noAddrVendor = (await db.query(`insert into public.vendors (name) values ('Address Unknown') returning id`)).rows[0].id;
const okStop = await mkStop({ name: `'Address Unknown'`, vendor_id: `'${noAddrVendor}'`,
  address: `'Somewhere real'`, starts_at: `now() + interval '7 days'`, lat: `1`, lng: `1` });
ok("a venue with no address on file does not accuse the stop that has one",
  !(await gapsFor(okStop)).includes("addr_drift"), await gapsFor(okStop));

const doneNoRecap = await mkStop({ name: `'Finished'`, status: `'done'`, starts_at: `now() - interval '2 days'`, lat: `1`, lng: `1` });
ok("finished with no after-action note is caught", (await gapsFor(doneNoRecap)).includes("no_recap"));
await db.exec(`insert into public.stop_ops (stop_id, recap) values ('${doneNoRecap}', 'Quiet morning, sold out of nitro')`);
ok("and not once one is written", !(await gapsFor(doneNoRecap)).includes("no_recap"));
ok("a done stop is not chased for a stale status", !(await gapsFor(doneNoRecap)).includes("stale_status"));

// ── 4) ARCHIVED IS FILED, NOT OUTSTANDING ──────────────────────────────────────────────────────
const arch = await mkStop({ name: `'Old Mistake'`, archived_at: `now()`, status: `'upcoming'`, starts_at: `now() - interval '40 days'` });
ok("an archived stop raises nothing, however wrong it is", (await gapsFor(arch)).length === 0, await gapsFor(arch));
ok("but it is still in the record view — archived is not deleted",
  !!(await q1(`select id from public.v_stop_record where id='${arch}'`)));

// ── 5) EVERY RULE FIRES, AND THE SEVERITIES ARE A CLOSED SET ───────────────────────────────────
// Two rows deliberately LEFT broken. The first run of this assertion failed on name_drift and
// no_recap — not because the rules are wrong, but because the tests above had fixed the only
// examples of each (resync repaired the drift, and a recap got written). A suite that repairs its
// own evidence and then checks the evidence is still there is a suite that will pass on a rule it
// deleted, so these two stay bad on purpose.
const lastingDrift = await mkStop({ name: `'Old Sign'`, vendor_id: `'${wine}'`,
  starts_at: `now() + interval '9 days'`, lat: `1`, lng: `1`, address: `'12 Main St, Greenville SC'` });
await db.exec(`update public.vendors set name = 'Wine Express Saturday' where id = '${wine}'`);
const lastingNoRecap = await mkStop({ name: `'Wrapped, Unwritten'`, status: `'done'`,
  starts_at: `now() - interval '4 days'`, lat: `1`, lng: `1`, vendor_id: `'${wine}'` });
ok("the deliberately-stale stop still reports drift", (await gapsFor(lastingDrift)).includes("name_drift"));
ok("and the unwritten one still wants a recap", (await gapsFor(lastingNoRecap)).includes("no_recap"));

const fired = (await all(`select distinct gap from public.v_stop_gaps order by gap`)).map((r) => r.gap);
ok("every rule in the view fires at least once in this fixture — an untested rule is a claim",
  fired.length === 8, fired);
ok("severities come from a closed set the screen can style",
  (await all(`select distinct severity from public.v_stop_gaps`)).every((r) => ["high", "medium", "low"].includes(r.severity)));
ok("the high ones are the four a guest or a driver would hit",
  (await all(`select distinct gap from public.v_stop_gaps where severity='high' order by gap`)).map((r) => r.gap)
    .join(",") === "live_past,name_drift,no_day,no_pin");

// ── 6) THE DECISION THIS ROUND DOES NOT TAKE, SIZED ────────────────────────────────────────────
await db.exec(`insert into public.vendor_locations (vendor_id, label) values ('${wine}','Downtown'), ('${wine}','Five Forks')`);
const debt = await q1(`select * from public.v_vendor_identity_debt`);
ok("the debt view counts venues and their locations", Number(debt.vendors) >= 3 && Number(debt.vendor_locations) === 2);
ok("and notices a venue with more than one place — the case 0226 was written for",
  Number(debt.locations_on_multi_site_vendors) === 2, debt.locations_on_multi_site_vendors);
ok("it counts the stops that point at no venue", Number(debt.stops_unlinked) >= 1);
ok("and states the zero that matters: nothing points at a vendor_location",
  Number(debt.stops_pointing_at_a_location) === 0);

// ── 7) the shape 0312 demands ─────────────────────────────────────────────────────────────────
const inv = await all(`select c.relname, coalesce(array_to_string(c.reloptions,','),'') as opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' and (c.relname like 'v_stop%' or c.relname='v_vendor_identity_debt') order by 1`);
ok("all three new views exist", inv.length === 3, inv.map((r) => r.relname));
ok("and every one honours the RLS on the tables underneath",
  inv.every((r) => /security_invoker=on/.test(r.opts)), inv.map((r) => r.opts));

// ── 8) ledger + changelog ─────────────────────────────────────────────────────────────────────
ok("0315 recorded itself by filename",
  (await q1(`select version as v from public.schema_migrations where seq=315`)).v === "0315_a_stop_is_a_visit_not_a_name");
ok("0316 too", (await q1(`select version as v from public.schema_migrations where seq=316`)).v === "0316_a_list_that_says_what_it_found");
ok("and said what changed, three times", Number((await q1(`select count(*) as c from public.changelog`)).c) === 3);

// ── 9) 0316: the list can state the disagreement, not just report one ──────────────────────────
// The defect this closes was invisible to every test above, because every test above asked the
// database a question and the database's answer was fine. It was only wrong on the SCREEN: three
// rows worded identically, none of them saying what either side called the place. So the check is
// that the row carries the other name — the sentence itself is lib/stopRecord's job and is smoked
// there, deliberately in one place rather than two.
const drift = await all(`select name, canonical_name from public.v_stop_gaps where gap='name_drift'`);
ok("a name_drift row carries BOTH names", drift.length > 0 && drift.every((r) => r.name && r.canonical_name), drift);
ok("and they actually differ — a row claiming drift with two equal names is the bug it reports",
  drift.every((r) => String(r.name).trim() !== String(r.canonical_name).trim()), drift);
const unl = await all(`select name, canonical_name from public.v_stop_gaps where gap='unlinked'`);
ok("an unlinked stop reports the two as equal, so no comparison is rendered against nothing",
  unl.every((r) => String(r.name).trim() === String(r.canonical_name).trim()), unl);

console.log(`\nA STOP IS A VISIT, NOT A NAME: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
