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
  -- A TEST DOUBLE MUST NOT LIE ABOUT THE THING IT DOUBLES. This stub said the ledger's key column
  -- was "name". Production (0304) calls it "version", and eleven of the thirteen db tests already
  -- stubbed it correctly — this file and db.messages were the two that did not. On 2026-09-30 that
  -- cost real time: schema_migrations.name went into production SQL twice, from memory, and the
  -- memory came from reading this. A double that contradicts its original teaches the wrong schema
  -- to everything downstream of it, the person included. Gated now against 0304's own text.
  create table public.schema_migrations (version text primary key, seq int not null,
    applied_at timestamptz default now(), note text, applied_count int default 1, evidence text);
  create or replace function public.record_migration(p_version text, p_note text default null)
    returns void language sql as $$
    insert into public.schema_migrations (version, seq, applied_at, note)
    values (p_version, coalesce(nullif(substring(p_version from '^[0-9]{4}'), '')::int, 0), now(), p_note)
    on conflict (version) do update set applied_count = public.schema_migrations.applied_count + 1 $$;
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

// ── WHAT THIS TEST DELETED, AND WHAT THAT COST (0333, 2026-09-30) ──────────────────────────────
// This line used to read:
//
//     delete from public.alerts where kind = 'heartbeat_stale';   ← then apply 0327
//
// It reproduced the flood above in careful detail, THREW THE FLOOD AWAY, and applied the fix to an
// empty table. Every assertion below it passed, and all of them were about a world where the bug
// had never happened. The one question it could not ask is the only one production was about to
// answer: what does 0327 do for the rows already there?
//
// Nothing. Production ran 0327 on 2026-09-29 and on 2026-09-30 the feed still held 50 unacked
// alerts, 40 of them critical, 32 of those one non-event — because 0258 exempts criticals from
// expiry ON PURPOSE and FOREVER, and 0327 downgraded only the rows written after it.
//
// A test that removes the condition before testing the remedy is the same animal as a gate that
// cannot fail. So the flood stays now, and 0258 comes with it, and the defect gets proved before
// it gets fixed.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0258_alert_autoexpire.sql"), "utf8"));
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0327_an_alert_that_cries_wolf.sql"), "utf8"));
ok("0327 applies against a real Postgres", true);
ok("0327 records itself", (await q1(
  `select count(*)::int n from public.schema_migrations where version = '0327_an_alert_that_cries_wolf'`)).n === 1);

// ── THE DEFECT, DEMONSTRATED ───────────────────────────────────────────────────────────────────
const stale = async () => (await q1(
  `select count(*)::int n from public.alerts where kind='heartbeat_stale' and ack_at is null`)).n;
ok("0327 leaves the three alerts already in the feed exactly where they were", (await stale()) === 3);
ok("…still calling themselves critical, though 0327 has just ruled that they are not", (await q1(
  `select count(*)::int n from public.alerts
    where kind='heartbeat_stale' and ack_at is null and severity='critical'`)).n === 3);

// Age them two months and sweep. 0258 is the ONLY mechanism that could clear them without a person.
await db.exec(`update public.alerts set created_at = now() - interval '60 days' where kind='heartbeat_stale'`);
await db.exec(`select public.alert_autoexpire()`);
ok("…and no amount of age lets the sweep reach them: critical is exempt, so they are permanent",
  (await stale()) === 3, await stale());

// ── 0333: THE FIX APPLIED TO THE FIX'S OWN OUTPUT ──────────────────────────────────────────────
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0333_the_fix_shipped_and_the_flood_stayed.sql"), "utf8"));
ok("0333 applies against a real Postgres", true);
ok("0333: the three become ONE open line — 0327's contract, applied to what 0327 left behind",
  (await stale()) === 1, await stale());
ok("0333: …carrying the count of all three, not resetting to one", Number((await q1(
  `select occurrences from public.alerts where kind='heartbeat_stale' and ack_at is null`)).occurrences) === 3);
ok("0333: …at the severity 0327 decided on, so the sweep can finally reach it", (await q1(
  `select severity from public.alerts where kind='heartbeat_stale' and ack_at is null`)).severity === "important");
ok("0333: …and titled what it actually means", /no uptime monitor/i.test((await q1(
  `select title from public.alerts where kind='heartbeat_stale' and ack_at is null`)).title));

// NOT DELETED. 0258's own rule: the row stays for history, it just leaves the live feed. A fix that
// destroyed an owner's alert history to tidy his inbox would be a worse bug than the one it fixed.
ok("0333: the folded rows are acknowledged, not destroyed — the history survives", (await q1(
  `select count(*)::int n from public.alerts where kind='heartbeat_stale' and ack_at is not null`)).n === 2);
ok("0333: …and acknowledged by nobody, which is this app's way of saying a mechanism did it", (await q1(
  `select count(*)::int n from public.alerts
    where kind='heartbeat_stale' and ack_at is not null and ack_by is null`)).n === 2);

// THE RE-RUN. A fold that double-counts would inflate the exact number it exists to make honest.
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0333_the_fix_shipped_and_the_flood_stayed.sql"), "utf8"));
ok("0333 is idempotent — a second run folds one row into itself and changes nothing",
  (await stale()) === 1 && Number((await q1(
    `select occurrences from public.alerts where kind='heartbeat_stale' and ack_at is null`)).occurrences) === 3);

// And now the sweep CAN reach it, which is the whole point of restating the severity.
await db.exec(`update public.alerts set created_at = now() - interval '60 days' where ack_at is null and kind='heartbeat_stale'`);
await db.exec(`select public.alert_autoexpire()`);
ok("0333: the row 0258 could never touch now ages out on its own, through the mechanism that already existed",
  (await stale()) === 0, await stale());

// ── IT MUST NOT HAVE TOUCHED ANYBODY ELSE'S CRITICALS ──────────────────────────────────────────
// The failure mode of "tidy the inbox" is tidying away the one alert that mattered. 0333 is allowed
// to restate heartbeat_stale because 0327 already ruled on it. Nothing else.
await db.exec(`insert into public.alerts (severity, category, title, body, kind)
  values ('critical','order','A paid order has not moved','x','shop_order_stalled'),
         ('critical','system','Something nobody has ruled on','x',null)`);
await db.exec(`update public.alerts set created_at = now() - interval '90 days' where ack_at is null`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0333_the_fix_shipped_and_the_flood_stayed.sql"), "utf8"));
ok("0333 does not clear other people's criticals, at any age — that is a human's call", (await q1(
  `select count(*)::int n from public.alerts where ack_at is null and severity='critical'`)).n === 2,
  (await q1(`select count(*)::int n from public.alerts where ack_at is null and severity='critical'`)).n);

// ── AND IT SAYS SO OUT LOUD ────────────────────────────────────────────────────────────────────
// Nothing in this app could answer "is the feed still readable", which is why two months of it
// going wrong was only ever noticed by a person scrolling.
const health = await q1(`select * from public.v_alert_feed_health`);
ok("v_alert_feed_health counts the unacked", health.unacked === 2, health);
ok("…and names the criticals no timer will ever clear", health.criticals === 2, health);
ok("…and the ones that have outlived every window any other severity gets",
  health.criticals_past_every_window === 2, health);
ok("…and gives a verdict in words, not a number to re-interpret on every screen",
  /only a person can clear them/i.test(health.verdict), health.verdict);

// The invisible ones. An alert past the fetch limit is not low in the list — it is not fetched, not
// counted in the badge, and cannot be acknowledged from any screen.
await db.exec(`insert into public.alerts (severity, category, title, body, kind)
  select 'critical','system','filler '||g,'x',null from generate_series(1,40) g`);
const h2 = await q1(`select * from public.v_alert_feed_health`);
ok("…and counts what the feed cannot show at all", h2.beyond_the_feed_window === 12, h2);
ok("…flagging an invisible critical above everything else, because a noisy feed is at least readable",
  h2.criticals_nobody_can_see > 0 && /no screen fetches/i.test(h2.verdict), h2.verdict);

// ── THE ORIGINAL CLAIM, ON A CLEAN FEED ────────────────────────────────────────────────────────
// Everything above is new. What follows is 0327's own contract, unchanged and still proved.
await db.exec(`delete from public.alerts`);

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
console.log(`0255 + 0258 + 0327 + 0333 executed against a real Postgres.\n`);
process.exit(fail ? 1 : 0);
