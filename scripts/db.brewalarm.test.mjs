// THE BREW ALARM THAT STOPPED RINGING — 0344, against a real Postgres.
//
// Three claims are worth a database:
//   1. The bug is real: 0174's brew_due_alerts(), run verbatim from its file over the columns
//      production has (brewer text since 0087, created_by uuid), fails with "COALESCE types text and
//      uuid cannot be matched" — so pg_cron's run every five minutes has rolled back every rung.
//   2. 0344 fixes it: the restated function runs, rings the moments that are current, and sends each
//      alarm to the brewer when one is named, else to whoever planned the batch.
//   3. Reviving it does not ring the past: a batch left planned or brewing for weeks gets no "start
//      now", no "time to bottle", no "over-extracting"; its status is left as it is; and a brew
//      critical nobody answered months ago is not re-pinged as "still open".
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
const T = "00000000-0000-0000-0000-000000000001";
const PLANNER = "00000000-0000-0000-0000-0000000000a1", BREWER = "00000000-0000-0000-0000-0000000000b2";

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${PLANNER}'), ('${BREWER}');
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
  create table public.events (id uuid primary key default gen_random_uuid(), title text);
  -- alerts with the columns 0174's insert names (0024 + 0084 + 0174)
  create table public.alerts (id uuid primary key default gen_random_uuid(), severity text, category text,
    kind text, subject_id uuid, title text, body text, link text, target_user_id uuid, created_by uuid,
    ack_at timestamptz, escalate_after_min int, escalated_at timestamptz, tenant_id uuid,
    created_at timestamptz not null default now());
  -- brew_batches as production has it: 0079 + the timer/ladder/log columns; brewer is TEXT (0087)
  create table public.brew_batches (
    id uuid primary key default gen_random_uuid(), tenant_id uuid default '${T}', recipe_name text,
    batch_gal numeric, ready_at timestamptz, event_id uuid, stop_id uuid, target_spec text, status text not null default 'planned',
    created_by uuid references auth.users(id) on delete set null, brew_started_at timestamptz,
    extraction_hours numeric, needed_by timestamptz, hold_hours numeric, latest_start_at timestamptz,
    alerted_soon boolean not null default false, alerted_ready boolean not null default false,
    alerted_start_window boolean not null default false, alerted_start_by boolean not null default false,
    alerted_at_risk boolean not null default false, alerted_started boolean not null default false,
    alerted_overextract boolean not null default false, alerted_hold_soon boolean not null default false,
    alerted_hold_expired boolean not null default false, brewer text);
`);

// ── 1 · THE BUG, AS 0174 LEFT IT ───────────────────────────────────────────────────────────────
const src174 = readFileSync(join(ROOT, "supabase/migrations/0174_actionable_alerts.sql"), "utf8");
const fn174 = src174.slice(src174.indexOf("create or replace function public.brew_due_alerts()"), src174.indexOf("create or replace function public.alert_stale_orders"));
await db.exec(fn174);
const H = 3600e3;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const ins = async (o) => (await q1(`insert into public.brew_batches (recipe_name, status, created_by, brewer, latest_start_at, ready_at, brew_started_at, hold_hours, batch_gal, extraction_hours, needed_by)
  values ($1, $2, $3, $4, $5, $6, $7, 72, 5, 20, $8) returning id`, [o.name, o.status, o.by ?? PLANNER, o.brewer ?? null, o.latest ?? null, o.ready ?? null, o.started ?? null, o.need ?? null])).id;
const stalePlanned = await ins({ name: "Stale plan", status: "planned", latest: at(-72 * H) });
const nowPlanned = await ins({ name: "Due now", status: "planned", latest: at(-30 * 60e3), need: at(20 * H) });
const staleBrewing = await ins({ name: "Stale brew", status: "brewing", ready: at(-240 * H), started: at(-260 * H) });
const bottleNow = await ins({ name: "Bottle me", status: "brewing", ready: at(-10 * 60e3), started: at(-20 * H), brewer: "Ryan" });
const oldCritical = (await q1(`insert into public.alerts (severity, category, kind, title, escalate_after_min, created_at, tenant_id)
  values ('critical', 'brew', 'brew_bottle_now', 'Time to bottle — May', 20, now() - interval '90 days', '${T}') returning id`)).id;
let err174 = null;
try { await db.query(`select public.brew_due_alerts()`); } catch (e) { err174 = String(e.message); }
ok("0174's function fails on the columns production has — every pg_cron run rolled back", /COALESCE types text and uuid cannot be matched/.test(err174 ?? ""), err174);
ok("…so nothing it should have rung exists", (await q1(`select count(*)::int as n from public.alerts`)).n === 1);

// ── 2 · 0344 ───────────────────────────────────────────────────────────────────────────────────
const SQL = readFileSync(join(ROOT, "supabase/migrations/0344_the_brew_alarm_that_stopped_ringing.sql"), "utf8");
await db.exec(SQL);
ok("0344: brewer_id is a uuid", (await q1(`select data_type from information_schema.columns where table_name = 'brew_batches' and column_name = 'brewer_id'`))?.data_type === "uuid");
const flags = async (id) => q1(`select status, alerted_start_by, alerted_at_risk, alerted_started, alerted_ready, alerted_overextract from public.brew_batches where id = $1`, [id]);
ok("existing rows: the stale plan's start-now and at-risk are history, its status untouched",
  (await flags(stalePlanned)).alerted_start_by === true && (await flags(stalePlanned)).alerted_at_risk === true && (await flags(stalePlanned)).status === "planned");
ok("existing rows: the stale brew's started, bottle-now and over-extract are history, still 'brewing'",
  (await flags(staleBrewing)).alerted_started && (await flags(staleBrewing)).alerted_ready && (await flags(staleBrewing)).alerted_overextract && (await flags(staleBrewing)).status === "brewing");
ok("existing rows: current moments are untouched", !(await flags(nowPlanned)).alerted_start_by && !(await flags(bottleNow)).alerted_ready);
ok("existing rows: a brew critical nobody answered months ago is marked escalated, not re-pinged",
  (await q1(`select escalated_at is not null as e from public.alerts where id = $1`, [oldCritical])).e === true);

await db.exec(`update public.brew_batches set brewer_id = '${BREWER}' where id = '${bottleNow}'`);
// Asserted, not inferred from a crash: a throw here would take every check below down with it.
let err344 = null;
try { await db.query(`select public.brew_due_alerts()`); } catch (e) { err344 = String(e.message); }
ok("0344: the restated function RUNS on the columns production has", err344 === null, err344);
const fired = await rows(`select kind, subject_id, target_user_id from public.alerts where created_at > now() - interval '1 minute' order by kind`);
const kinds = fired.map((a) => `${a.kind}:${a.subject_id === nowPlanned ? "due" : a.subject_id === bottleNow ? "bottle" : a.subject_id === stalePlanned ? "STALE-PLAN" : a.subject_id === staleBrewing ? "STALE-BREW" : "?"}`);
ok("0344: the function runs, and rings what is current — start now for the due plan, time to bottle for the ready brew",
  kinds.includes("brew_start_now:due") && kinds.includes("brew_bottle_now:bottle"), kinds);
ok("0344: …and nothing for the batches left behind", !kinds.some((k) => /STALE/.test(k)), kinds);
ok("0344: the alarm goes to the brewer when one is named", fired.find((a) => a.kind === "brew_bottle_now")?.target_user_id === BREWER);
ok("0344: …else to whoever planned the batch", fired.find((a) => a.kind === "brew_start_now")?.target_user_id === PLANNER);
ok("0344: time to bottle still moves the batch to ready", (await flags(bottleNow)).status === "ready");
ok("0344: the restated text is 0174's with the target changed and nothing else",
  (await q1(`select prosrc from pg_proc where proname = 'brew_due_alerts'`)).prosrc.replace(/coalesce\(b\.brewer_id, b\.created_by\)/g, "X")
    === fn174.slice(fn174.indexOf("$$") + 2, fn174.lastIndexOf("$$")).replace(/coalesce\(b\.brewer,b\.created_by\)/g, "X"));

// ── 3 · TWICE ──────────────────────────────────────────────────────────────────────────────────
await db.exec(SQL);
ok("0344 twice: one changelog row", (await q1(`select count(*)::int as n from public.changelog where area = 'Brew'`)).n === 1);
ok("0344 twice: the ledger counts the re-run", (await q1(`select applied_count from public.schema_migrations where version = '0344_the_brew_alarm_that_stopped_ringing'`)).applied_count === 2);

console.log(`\nTHE BREW ALARM (0344): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
