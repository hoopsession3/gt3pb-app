// AN ALERT THAT CRIES WOLF — 0327, executed from its file against a real Postgres.
//
// The claim: a condition that recurs produces ONE line with a count, not N identical lines. The
// first flagship cap's "New shop order" alert arrived fifth in the inbox, under four copies of the
// same heartbeat warning, in an inbox reading 24 · 20 CRITICAL of which almost all were that one
// condition repeating since Sep 9.
//
// The expensive damage there is not the noise. It is that an owner learns his critical alerts are
// noise, and then a real one arrives and he scrolls past it.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const db = new PGlite();
const q1 = async (s) => (await db.query(s)).rows[0];

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  -- 0050 adds alerts to Supabase's realtime publication; PGlite has no such publication, and
  -- realtime is not what is under test here.
  create publication supabase_realtime;
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema if not exists cron;
  create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create table public.profiles (id uuid primary key, role text default 'owner');
  create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_staff() returns boolean language sql stable as $$ select true $$;
  create table public.tenants (id uuid primary key default '00000000-0000-0000-0000-000000000001');
  insert into public.tenants (id) values ('00000000-0000-0000-0000-000000000001');
  create table public.changelog (
    id uuid primary key default gen_random_uuid(), title text, category text, area text,
    summary text, shipped_on date, highlight boolean default false
  );
  create table public.schema_migrations (name text primary key, note text, applied_at timestamptz default now());
  create or replace function public.record_migration(p_name text, p_note text) returns void language sql as $$
    insert into public.schema_migrations (name, note) values (p_name, p_note)
    on conflict (name) do update set note = excluded.note $$;
`);

// 0050's alerts table and 0255's watchdog, from their own files — the thing being changed.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0050_alerts.sql"), "utf8"));
// 0174 is what gives an alert a `kind` — the column the whole dedupe turns on.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0174_actionable_alerts.sql"), "utf8"));
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0255_ops_heartbeat_watchdog.sql"), "utf8"));

// ── FIRST, REPRODUCE THE FLOOD ─────────────────────────────────────────────────────────────────
// A fix whose bug you cannot demonstrate is a fix you cannot trust. With no uptime monitor, every
// visit to the app stamps the heartbeat and every stale stretch afterwards opens ANOTHER alert.
// My first version of this got it wrong and the test said so: 0255's guard is
// `created_at > hb`, so replaying with a stamp OLDER than the existing alert is correctly
// suppressed. The real loop needs the visit to land AFTER the last alert — which is exactly what
// happens when somebody opens the app, or a developer curls /api/health to verify a deploy.
//
// visitedMinsAgo: somebody touched /api/health that long ago, and it has been quiet since.
const episode = async (visitedMinsAgo) => {
  // Age the existing alerts past the visit we are about to simulate. That is simply what the
  // passage of real time does — the previous alert was raised BEFORE somebody next opened the app —
  // and without it 0255's `created_at > hb` guard correctly suppresses everything, which is what my
  // first version of this test got wrong.
  await db.exec(`update public.alerts set created_at = now() - interval '${visitedMinsAgo + 30} minutes'
                  where kind = 'heartbeat_stale'`);
  await db.exec(`update public.ops_heartbeat set seen_at = now() - interval '${visitedMinsAgo} minutes' where id = 1`);
  await db.exec(`select public.heartbeat_watchdog()`);
};
await episode(240);   // quiet for four hours  → alert
await episode(150);   // a visit 2.5h ago, quiet since → another
await episode(60);    // a visit an hour ago, quiet since → another
const before = (await q1(`select count(*)::int n from public.alerts where kind = 'heartbeat_stale'`)).n;
ok("0255: three visits and three stale stretches produce THREE separate alerts — the flood, reproduced",
  before === 3, before);
ok("0255: and every one of them is critical", (await q1(
  `select count(*)::int n from public.alerts where kind = 'heartbeat_stale' and severity = 'critical'`)).n === 3);

// ── NOW THE FIX ────────────────────────────────────────────────────────────────────────────────
await db.exec(`delete from public.alerts where kind = 'heartbeat_stale'`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0327_an_alert_that_cries_wolf.sql"), "utf8"));
ok("0327 applies against a real Postgres", true);
ok("0327 records itself", (await q1(
  `select count(*)::int n from public.schema_migrations where name = '0327_an_alert_that_cries_wolf'`)).n === 1);

await episode(240);
await episode(150);
await episode(60);

const row = await q1(`select count(*)::int n, max(occurrences) occ, max(severity) sev, max(title) title
  from public.alerts where kind = 'heartbeat_stale'`);
ok("0327: the same three stale stretches now produce ONE line", row.n === 1, row);
ok("0327: …that counts them", Number(row.occ) === 3, row);
ok("0327: …and is not called critical, because a missing monitor is not an outage",
  row.sev === "important", row);
ok("0327: …and no longer claims the app is down, which was never what it meant",
  /no uptime monitor/i.test(row.title) && !/heartbeat lost/i.test(row.title), row.title);
ok("0327: the body says what to do about it",
  /uptime service/i.test((await q1(`select body from public.alerts where kind = 'heartbeat_stale'`)).body));
ok("0327: last_seen_at moves even though the row does not multiply",
  (await q1(`select last_seen_at is not null ok from public.alerts where kind = 'heartbeat_stale'`)).ok === true);

// ── AND IT MUST STILL BE ABLE TO TELL YOU AGAIN ────────────────────────────────────────────────
// Folding recurrences into an open row is only safe while the row is unread. An owner who has
// cleared it is asking to be told next time — a "fix" that silenced the alert permanently would be
// worse than the flood it replaced.
await db.exec(`update public.alerts set ack_at = now() where kind = 'heartbeat_stale'`);
await episode(45);
ok("0327: once acknowledged, the next stale stretch opens a NEW alert — silence is not the fix",
  (await q1(`select count(*)::int n from public.alerts where kind = 'heartbeat_stale'`)).n === 2,
  (await q1(`select count(*)::int n from public.alerts where kind = 'heartbeat_stale'`)).n);
ok("0327: and the acknowledged one keeps its count rather than being rewritten",
  Number((await q1(`select occurrences from public.alerts where kind = 'heartbeat_stale' and ack_at is not null`)).occurrences) === 3);

// A fresh heartbeat inside the window must still produce nothing at all.
await db.exec(`delete from public.alerts where kind = 'heartbeat_stale'`);
await db.exec(`update public.ops_heartbeat set seen_at = now() where id = 1`);
await db.exec(`select public.heartbeat_watchdog()`);
ok("0327: a healthy heartbeat raises nothing — the check still has to be able to stay quiet",
  (await q1(`select count(*)::int n from public.alerts where kind = 'heartbeat_stale'`)).n === 0);

console.log(`AN ALERT THAT CRIES WOLF: ${pass} passed, ${fail} failed`);
console.log(`0255 + 0327 executed against a real Postgres.\n`);
process.exit(fail ? 1 : 0);
