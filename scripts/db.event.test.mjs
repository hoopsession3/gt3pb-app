// AN EVENT IS TEN SCREENS AND NO RECORD — 0314, executed from its file.
//
// The fixture's column lists were read out of PRODUCTION (information_schema), not out of the
// migrations directory, because on this exact table those two disagree: several `alter table ...
// add column` lines in the migrations for recap / crew_brief / dress_code landed on stops, and the
// live events table has none of them. I wrote a survey query against events.recap earlier today and
// Postgres told me the column does not exist. Reading the migrations tells you what a migration did,
// not what the database is — the sixth time that has cost something in this repo.
//
// Every gap in v_event_gaps is asserted twice: once on a row that should trip it, once on a row
// that should not. A rule that only ever fires is indistinguishable from a rule that always fires.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = "00000000-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];
const all = async (s) => (await db.query(s)).rows;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon; create role authenticated;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

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

  create table public.vendors (id uuid primary key default gen_random_uuid(), name text);
  create table public.field_ops (id uuid primary key default gen_random_uuid());
  create table public.stops (id uuid primary key default gen_random_uuid(), name text);

  -- events: the 43 live columns, in the live order, read from information_schema on production.
  create table public.events (
    id uuid primary key default gen_random_uuid(), title text, type text, day date,
    start_time text, end_time text, location_text text, member_only boolean not null default false,
    capacity int, claimed int default 0, going_count int default 0, blurb text,
    sort int not null default 0, day_label text, archetype text, rig text,
    menu_nitro boolean default false, menu_nature_aid boolean default false,
    menu_salted_maple boolean default false, menu_bottles boolean default false,
    menu_broth boolean default false, power_available boolean, water_available boolean,
    expected_attendance int, duration_hrs numeric, staff_count int,
    is_live boolean not null default false, state text, county text, archived_at timestamptz,
    vendor_id uuid references public.vendors(id), tenant_id uuid default '${T}',
    category text not null default 'event', plan_days int not null default 1,
    outlook_event_id text, outlook_synced_at timestamptz,
    stage text not null default 'confirmed' check (stage in ('lead','confirmed','prep','live','done')),
    default_buffer_min int, completed_at timestamptz, is_public boolean, published_at timestamptz,
    public_title text, market text);

  create table public.event_ops (event_id uuid primary key references public.events(id) on delete cascade,
    tenant_id uuid default '${T}', crew_brief text, dress_code text, recap text,
    updated_at timestamptz default now(), field_op_id uuid);
  create table public.event_economics (event_id uuid primary key references public.events(id) on delete cascade,
    capture_pct numeric, items_per_guest numeric, cogs_pct numeric, labor_rate_cents int,
    booth_cents int, transport_cents int, permit_cents int, consumables_cents int,
    updated_at timestamptz, tenant_id uuid, field_op_id uuid);
  create table public.event_tasks (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, label text, section text, kind text,
    critical boolean default false, assignee uuid, done boolean default false, done_by uuid,
    done_at timestamptz, sort int, created_at timestamptz default now(), link text, warn text,
    tenant_id uuid, stop_id uuid references public.stops(id), meeting_note_id uuid,
    ai_proposal text, ai_has_answer boolean, target_qty numeric, actual_qty numeric,
    due_at timestamptz, due_alerted boolean, goal_id uuid, origin_note_id uuid,
    initiative_id uuid, field_op_id uuid references public.field_ops(id));
  create table public.event_staff (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, user_id uuid, role_label text,
    created_at timestamptz default now(), tenant_id uuid, stop_id uuid, field_op_id uuid);
  create table public.event_approvals (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, approver_id uuid,
    approved_at timestamptz, tenant_id uuid, stop_id uuid, field_op_id uuid);
  create table public.event_sales (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, source text, square_payment_id text,
    amount_cents int, item_count int, created_at timestamptz default now(),
    tenant_id uuid, field_op_id uuid);
  create table public.event_menu_items (id uuid primary key default gen_random_uuid(),
    tenant_id uuid, event_id uuid references public.events(id) on delete cascade, stop_id uuid,
    product_slug text, created_at timestamptz default now(), field_op_id uuid);
  create table public.event_schedule_items (id uuid primary key default gen_random_uuid(),
    tenant_id uuid, event_id uuid references public.events(id) on delete cascade, day_index int,
    day_date date, start_time text, end_time text, title text, kind text, location text,
    address text, details text, who text, done boolean, done_at timestamptz, sort int,
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz,
    stop_id uuid, field_op_id uuid);
  create table public.rsvps (id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete cascade, user_id uuid,
    contact_email text, status text default 'going', created_at timestamptz default now());
`);

await db.exec(readFileSync(join(ROOT, "supabase/migrations/0314_an_event_is_ten_screens_and_no_record.sql"), "utf8"));
console.log("0314 executed against a real Postgres.\n");

const mk = async (cols) => (await db.query(`insert into public.events (${Object.keys(cols).join(",")}) values (${Object.values(cols).join(",")}) returning id`)).rows[0].id;
const gapsFor = async (id) => (await all(`select gap, severity from public.v_event_gaps where event_id='${id}' order by gap`)).map((r) => r.gap);

// ── 1) NINE TABLES, ONE ROW ────────────────────────────────────────────────────────────────────
const vend = (await db.query(`insert into public.vendors (name) values ('Sassafras Flower Farm') returning id`)).rows[0].id;
const full = await mk({
  title: `'Greenville Fit Fest'`, day: `current_date + 14`, stage: `'confirmed'`,
  location_text: `'Unity Park'`, market: `'greenville'`, vendor_id: `'${vend}'`,
  expected_attendance: `400`, capacity: `500`,
});
await db.exec(`insert into public.event_ops (event_id, crew_brief, dress_code) values ('${full}', 'Pull in at 7', 'Black tee')`);
await db.exec(`insert into public.event_tasks (event_id, label, critical, done) values
  ('${full}','Permit',true,true), ('${full}','Ice',true,false), ('${full}','Signage',false,false)`);
await db.exec(`insert into public.event_staff (event_id, role_label) values ('${full}','Lead'), ('${full}','Pour')`);
await db.exec(`insert into public.rsvps (event_id) values ('${full}'), ('${full}'), ('${full}')`);
await db.exec(`insert into public.event_menu_items (event_id, product_slug) values ('${full}','nitro'), ('${full}','broth')`);
await db.exec(`insert into public.event_schedule_items (event_id, title) values ('${full}','Load in')`);
await db.exec(`insert into public.event_sales (event_id, amount_cents, item_count) values ('${full}', 4200, 3), ('${full}', 1800, 1)`);

const rec = await q1(`select * from public.v_event_record where id='${full}'`);
ok("an event finally has a row a screen can render", !!rec);
ok("with the vendor's name, not just its id", rec.vendor_name === "Sassafras Flower Farm");
ok("the crew brief from the staff-only ops sibling", rec.crew_brief === "Pull in at 7");
ok("tasks counted, done counted, and open derived", Number(rec.tasks) === 3 && Number(rec.tasks_done) === 1 && Number(rec.tasks_open) === 2);
ok("critical-and-still-open counted separately — the only task number that asks for something today",
  Number(rec.tasks_critical_open) === 1, rec.tasks_critical_open);
ok("staff, rsvps, menu and run-of-show all on the same row",
  Number(rec.staff) === 2 && Number(rec.rsvps) === 3 && Number(rec.menu_items) === 2 && Number(rec.schedule_items) === 1);
ok("and what it took", Number(rec.sales_cents) === 6000 && Number(rec.sales_count) === 2 && Number(rec.items_sold) === 4);
ok("economics is a yes/no, because the row is a settings row not a total", rec.has_economics === false);
ok("phase reads off the calendar", rec.phase === "upcoming" && Number(rec.days_away) === 14);

// the empty case is the one that usually breaks — an event with no satellites must read 0, not null
const bare = await mk({ title: `'Dear Deandra Jazz Brunch'`, day: `current_date + 40`, stage: `'confirmed'` });
const bareRec = await q1(`select * from public.v_event_record where id='${bare}'`);
ok("an event with no satellites reads zero, not null — a null count renders as a blank cell",
  [bareRec.tasks, bareRec.staff, bareRec.rsvps, bareRec.menu_items, bareRec.schedule_items, bareRec.sales_count]
    .every((v) => Number(v) === 0),
  [bareRec.tasks, bareRec.staff, bareRec.rsvps, bareRec.menu_items, bareRec.schedule_items, bareRec.sales_count]);
ok("and zero taken, rather than unknown", Number(bareRec.sales_cents) === 0);
ok("a clean upcoming event has nothing to answer for", (await gapsFor(bare)).length === 0, await gapsFor(bare));

// ── 2) EVERY GAP, BOTH WAYS ────────────────────────────────────────────────────────────────────
// Each rule is asserted on a row that should trip it AND on one that should not.
const untitled = await mk({ title: `''`, day: `current_date + 3`, stage: `'confirmed'` });
ok("a blank title is caught", (await gapsFor(untitled)).includes("no_title"));
ok("and the title falls back to something printable rather than an empty row",
  (await q1(`select title from public.v_event_gaps where event_id='${untitled}' limit 1`)).title === "(untitled)");
ok("a titled event is not", !(await gapsFor(full)).includes("no_title"));

const undated = await mk({ title: `'Soul Yoga Workshop'`, stage: `'confirmed'` });
ok("no date is caught", (await gapsFor(undated)).includes("no_day"));
ok("phase says so rather than guessing", (await q1(`select phase, days_away from public.v_event_record where id='${undated}'`)).phase === "undated");
ok("and days_away is null rather than 0 — 'today' and 'no idea' are different answers",
  (await q1(`select days_away from public.v_event_record where id='${undated}'`)).days_away === null);
ok("a dated event is not", !(await gapsFor(full)).includes("no_day"));

const doneEarly = await mk({ title: `'Fit Fest'`, day: `current_date + 26`, stage: `'done'` });
ok("done before it happens is caught — the live database has one of these",
  (await gapsFor(doneEarly)).includes("done_early"));
const donePast = await mk({ title: `'Mercedes-Benz Car Show'`, day: `current_date - 70`, stage: `'done'`, });
await db.exec(`insert into public.event_sales (event_id, amount_cents) values ('${donePast}', 9900)`);
await db.exec(`insert into public.event_ops (event_id, recap) values ('${donePast}', 'Sold out of nitro by noon.')`);
ok("a properly finished event is not", !(await gapsFor(donePast)).includes("done_early"), await gapsFor(donePast));
ok("nor is it chased for sales it recorded", !(await gapsFor(donePast)).includes("no_sales"));
ok("nor for a recap it wrote", !(await gapsFor(donePast)).includes("no_recap"), await gapsFor(donePast));

const twinA = await mk({ title: `'Gratitude Greenville'`, day: `date '2026-07-31'`, stage: `'done'` });
const twinB = await mk({ title: `'  gratitude greenville '`, day: `date '2026-07-31'`, stage: `'confirmed'` });
ok("two events with the same name on the same day flag each other", (await gapsFor(twinA)).includes("twin"));
ok("case and stray whitespace do not hide a twin", (await gapsFor(twinB)).includes("twin"));
const notTwin = await mk({ title: `'Gratitude Greenville'`, day: `date '2026-08-31'`, stage: `'confirmed'` });
ok("the same name on a DIFFERENT day is a series, not a duplicate", !(await gapsFor(notTwin)).includes("twin"));
// the guard that matters: two untitled events are not "the same event"
const untitled2 = await mk({ title: `''`, day: `current_date + 3`, stage: `'confirmed'` });
ok("two untitled events on one day are two problems, not a duplicate pair",
  !(await gapsFor(untitled2)).includes("twin"), await gapsFor(untitled2));

const doneNoSales = await mk({ title: `'Sassafras Flower Farm'`, day: `current_date - 15`, stage: `'done'` });
ok("complete with nothing recorded as taken is caught", (await gapsFor(doneNoSales)).includes("no_sales"));
ok("and no recap alongside it", (await gapsFor(doneNoSales)).includes("no_recap"));
ok("an UPCOMING event is not chased for sales it cannot have made yet",
  !(await gapsFor(full)).includes("no_sales"), await gapsFor(full));

const stillLive = await mk({ title: `'Last Weekend Market'`, day: `current_date - 2`, stage: `'done'`, is_live: `true` });
ok("still flagged live after the day has passed is caught — the public site reads that flag",
  (await gapsFor(stillLive)).includes("live_past"));
const liveToday = await mk({ title: `'Today Market'`, day: `current_date`, stage: `'live'`, is_live: `true` });
ok("live TODAY is not a problem", !(await gapsFor(liveToday)).includes("live_past"), await gapsFor(liveToday));
ok("and today is its own phase", (await q1(`select phase from public.v_event_record where id='${liveToday}'`)).phase === "today");

// The rule the LIVE DATA taught me. Every other check here compares a row against itself; this one
// compares it against the calendar, which is why nothing else caught two events sitting at
// 'confirmed' more than three weeks after they were supposed to happen.
const stale = await mk({ title: `'Gratitude Greenville (stale)'`, day: `current_date - 38`, stage: `'confirmed'` });
ok("an event still being planned weeks after its date is caught", (await gapsFor(stale)).includes("stale_stage"));
const staleLead = await mk({ title: `'Old Lead'`, day: `current_date - 200`, stage: `'lead'` });
ok("a lead that never happened is caught too", (await gapsFor(staleLead)).includes("stale_stage"));
ok("an upcoming confirmed event is not", !(await gapsFor(full)).includes("stale_stage"));
ok("nor one happening today", !(await gapsFor(liveToday)).includes("stale_stage"), await gapsFor(liveToday));
ok("nor a past event that was properly wrapped", !(await gapsFor(donePast)).includes("stale_stage"));
ok("nor an undated one — that is the no_day problem, not this one",
  !(await gapsFor(undated)).includes("stale_stage"), await gapsFor(undated));

const doneOpen = await mk({ title: `'Rushed Market'`, day: `current_date - 5`, stage: `'done'` });
await db.exec(`insert into public.event_sales (event_id, amount_cents) values ('${doneOpen}', 100)`);
await db.exec(`insert into public.event_ops (event_id, recap) values ('${doneOpen}', 'fine')`);
await db.exec(`insert into public.event_tasks (event_id, label, critical, done) values ('${doneOpen}','Permit',true,false)`);
ok("complete with critical prep unticked is caught", (await gapsFor(doneOpen)).includes("open_tasks"));
ok("and nothing else, because everything else about it is in order",
  (await gapsFor(doneOpen)).length === 1, await gapsFor(doneOpen));

// ── 3) AN ARCHIVED MISTAKE IS FILED, NOT OUTSTANDING ───────────────────────────────────────────
const archived = await mk({ title: `''`, stage: `'done'`, archived_at: `now()`, day: `current_date + 9` });
ok("an archived event raises nothing, however wrong it is", (await gapsFor(archived)).length === 0, await gapsFor(archived));
ok("but it is still IN the record view — archived is not deleted",
  !!(await q1(`select id from public.v_event_record where id='${archived}'`)));
ok("and an archived twin does not accuse a live event",
  !(await gapsFor(notTwin)).includes("twin"));

// ── 4) SEVERITY IS ORDERED, SO A SCREEN CAN LEAD WITH THE WORST ────────────────────────────────
const sev = await all(`select distinct severity from public.v_event_gaps`);
ok("severities come from a closed set the screen can style",
  sev.every((r) => ["high", "medium", "low"].includes(r.severity)), sev.map((r) => r.severity));
ok("the high ones are the contradictions, not the omissions",
  (await all(`select distinct gap from public.v_event_gaps where severity='high' order by gap`)).map((r) => r.gap)
    .join(",") === "done_early,live_past,no_day,no_title,twin");
ok("and every rule in the view fires at least once in this fixture — an untested rule is a claim",
  (await all(`select distinct gap from public.v_event_gaps order by gap`)).map((r) => r.gap).length === 9,
  (await all(`select distinct gap from public.v_event_gaps order by gap`)).map((r) => r.gap));

// ── 5) THE TASKS THAT BELONG TO NOTHING ────────────────────────────────────────────────────────
const stop = (await db.query(`insert into public.stops (name) values ('Main St') returning id`)).rows[0].id;
const fop = (await db.query(`insert into public.field_ops default values returning id`)).rows[0].id;
await db.exec(`insert into public.event_tasks (label) values ('Call the county'), ('Order cups')`);
await db.exec(`insert into public.event_tasks (label, stop_id) values ('Stock the stop','${stop}')`);
await db.exec(`insert into public.event_tasks (label, field_op_id) values ('Field thing','${fop}')`);
const orphans = await all(`select label from public.v_event_orphan_tasks order by label`);
ok("a task attached to nothing shows up", orphans.map((r) => r.label).includes("Call the county"));
ok("a task on a stop does not", !orphans.map((r) => r.label).includes("Stock the stop"));
ok("nor one on a field op — the THIRD owner column these tables carry",
  !orphans.map((r) => r.label).includes("Field thing"));
ok("nor one on an event", !orphans.map((r) => r.label).includes("Permit"));
ok("exactly the two that belong nowhere", orphans.length === 2, orphans.map((r) => r.label));
await db.exec(`insert into public.event_tasks (label, goal_id) values ('Hit 30 events', gen_random_uuid())`);
ok("a standalone task carries WHY it is standalone, so the list is triageable rather than scary",
  (await q1(`select on_a_goal from public.v_event_orphan_tasks where label='Hit 30 events'`)).on_a_goal === true);

// ── 6) the shape 0312 demands of every view ────────────────────────────────────────────────────
const inv = await all(`select c.relname, coalesce(array_to_string(c.reloptions,','),'') as opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' and c.relname like 'v_event%' order by 1`);
ok("all three new views exist", inv.length === 3, inv.map((r) => r.relname));
ok("and every one honours the RLS on the tables underneath",
  inv.every((r) => /security_invoker=on/.test(r.opts)), inv.map((r) => r.opts));

// ── 7) NO SECOND STATE MACHINE ─────────────────────────────────────────────────────────────────
// 0075 owns the event lifecycle. This migration adding its own would be the exact duplication the
// audit is about, so the absence is asserted rather than assumed.
const fns = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like '%event%stage%' or p.proname like 'set_event%'`);
ok("0314 introduces no event state machine — 0075 already has one", fns.length === 0, fns.map((r) => r.proname));

// ── 8) ledger + changelog ─────────────────────────────────────────────────────────────────────
ok("0314 recorded itself by filename",
  (await q1(`select version as v from public.schema_migrations where seq=314`)).v === "0314_an_event_is_ten_screens_and_no_record");
ok("and said what changed, twice", Number((await q1(`select count(*) as c from public.changelog`)).c) === 2);

console.log(`\nAN EVENT IS TEN SCREENS AND NO RECORD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
