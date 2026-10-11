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
const rows = async (s) => (await db.query(s)).rows;

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
// 0157 is the fan-out (every alert INSERT is a push to every owner's phone and a Teams message) and
// the per-person read state behind "Got it". Its trigger calls supabase_functions.http_request,
// which PGlite does not have: the double RECORDS each call instead of making it, so the 0340 block
// below can count the pushes a change would have sent, which is the cost an owner actually feels.
await db.exec(`
  create schema if not exists supabase_functions;
  create table public.test_pushes (alert_id uuid, at timestamptz default now());
  create or replace function supabase_functions.http_request() returns trigger language plpgsql as $$
  begin insert into public.test_pushes (alert_id) values (new.id); return new; end $$;
`);
await db.exec(readFileSync(join(ROOT, "supabase/migrations/0157_alert_spine.sql"), "utf8"));
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


// ── THE GUARD THAT MATCHED ON A SENTENCE (0336) ────────────────────────────────────────────────
// 0174's alert_stale_orders asks "have I already warned about this?" with
//   title like '%waiting on the pass%'
// while WRITING kind='order_stale' three lines below. The key is there and unused, so the dedupe
// survives only until somebody edits the copy — and the cron is */5.
{
  await db.exec(`create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(), status text, created_at timestamptz default now())`);
  const stale = async () => (await q1(
    `select count(*)::int n from public.alerts where kind='order_stale' or title like '%pass%'`)).n;
  const backUp = async () => db.exec(`insert into public.orders (status, created_at)
    values ('new', now() - interval '30 minutes')`);

  await backUp();
  await db.exec(`select public.alert_stale_orders(10)`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0174: the prose guard does hold — while the prose is untouched", (await stale()) === 1);

  // NOW EDIT THE COPY — in the FUNCTION, which is what a person actually does. My first version of
  // this test rewrote the stored ROWS instead and only produced one extra alert, so it failed
  // against correct code and the premise was the thing that was wrong. The guard and the title live
  // in the same function and have to agree; editing one and not the other is a two-line diff that
  // looks like a copy change.
  await db.exec(`delete from public.alerts where kind='order_stale'`);
  await db.exec(`create or replace function public.alert_stale_orders(grace_min int default 10) returns int
    language plpgsql security definer set search_path = public as $$
    declare n int;
    begin
      select count(*) into n from public.orders
       where status = 'new' and created_at < now() - make_interval(mins => greatest(grace_min, 2));
      if n > 0 then
        if not exists (
          select 1 from public.alerts
           where category = 'order' and title like '%waiting on the pass%'
             and (ack_at is null or created_at > now() - interval '15 minutes')
        ) then
          insert into public.alerts (severity, category, kind, title, body, link)
          values ('important', 'order', 'order_stale',
                  '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting at the counter',
                  'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
                  '/admin');
        end if;
      end if;
      return n;
    end $$;`);
  for (let i = 0; i < 6; i++) await db.exec(`select public.alert_stale_orders(10)`);
  const flooded = await stale();
  ok("0174: one word changed in the copy and every run opens another — the flood, reproduced",
    flooded === 6, flooded);
  ok("0174: …and at */5 that is one alert every five minutes, all day",
    flooded >= 6, `${flooded} alerts from 6 runs`);

  // ── 0336 ───────────────────────────────────────────────────────────────────────────────────
  await db.exec(`delete from public.alerts where kind='order_stale' or title like '%pass%' or title like '%counter%'`);
  await db.exec(readFileSync(join(ROOT, "supabase/migrations/0336_the_guard_that_matched_on_a_sentence.sql"), "utf8"));
  ok("0336 applies against a real Postgres", true);

  await db.exec(`select public.alert_stale_orders(10)`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0336: two runs, one alert", (await stale()) === 1);

  // THE ONE THAT MATTERS. Same edit, same reason, and now it changes nothing — because the guard
  // asks about the key the producer writes, not about the sentence a human can rewrite.
  await db.exec(`update public.alerts set title = replace(title, 'waiting on the pass', 'waiting at the counter')
                  where kind = 'order_stale'`);
  await db.exec(`select public.alert_stale_orders(10)`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0336: rewording the copy no longer breaks the dedupe — the landmine, disarmed",
    (await stale()) === 1, await stale());

  // 0174's COOLDOWN, which I nearly dropped. Its guard was (ack_at is null OR created_at > 15 min
  // ago): acknowledging must NOT get you a new one on the next */5 tick.
  await db.exec(`update public.alerts set ack_at = now() where kind='order_stale'`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0336: acking does not reopen it five minutes later — 0174's 15-minute cooldown survived",
    (await q1(`select count(*)::int n from public.alerts where kind='order_stale' and ack_at is null`)).n === 0);

  // …but it is a cooldown, not a silencer. Age the acked one past the window and it opens again.
  await db.exec(`update public.alerts set created_at = now() - interval '2 hours' where kind='order_stale'`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0336: …and once the cooldown passes, a still-backed-up pass says so again",
    (await q1(`select count(*)::int n from public.alerts where kind='order_stale' and ack_at is null`)).n === 1);

  // The condition clearing must raise nothing at all.
  await db.exec(`delete from public.alerts where kind='order_stale'`);
  await db.exec(`update public.orders set status='done'`);
  await db.exec(`select public.alert_stale_orders(10)`);
  ok("0336: an empty pass raises nothing — the check can still stay quiet", (await stale()) === 0);

  // A kind is the key, so it cannot be omitted.
  let noKind = null;
  try { await db.exec(`select public.alert_open_once('')`); } catch (e) { noKind = String(e?.message ?? e); }
  ok("0336: alert_open_once refuses an empty kind — that is the key the dedupe turns on",
    noKind !== null && /kind/i.test(noKind), noKind);

  // NULL subject is a real key (the heartbeat has none). `subject_id = null` is never true, so a
  // naive `=` would make every such alert a brand new row — the flood, rebuilt by accident.
  await db.exec(`select public.alert_open_once('whole_app_thing', null, 'fyi', 'system', 'x', 'y', '/crew')`);
  await db.exec(`select public.alert_open_once('whole_app_thing', null, 'fyi', 'system', 'x', 'y', '/crew')`);
  ok("0336: a null subject is a key, not a wildcard — two calls, one row",
    (await q1(`select count(*)::int n from public.alerts where kind='whole_app_thing'`)).n === 1);

  ok("0336: authenticated cannot execute it", (await q1(
    `select has_function_privilege('authenticated',
      'public.alert_open_once(text,uuid,text,text,text,text,text,interval)','execute') as v`)).v === false);

  ok("0336 recorded itself", (await q1(
    `select count(*)::int n from public.schema_migrations
      where version='0336_the_guard_that_matched_on_a_sentence'`)).n === 1);
}


// ── 0340: A MONITOR JUDGED BY ITS OWN PERIOD ───────────────────────────────────────────────────
// Ryan's inbox, 2026-10-04: "No uptime monitor is watching the app ×63". A monitor had existed for
// two days — production.yml, verify:prod --quick every thirty minutes, each run stamping the
// heartbeat — and the watchdog called a stamp stale after thirty. GitHub's scheduler is late by
// documented policy (top-of-hour load; queued runs dropped), so every late run was a "silence".
//
// TIME IS SIMULATED THE WAY THE EPISODE HELPER ABOVE DOES IT: by moving every stored clock
// backwards, which is all the passage of time is to rows that only ever compare themselves to now().
{
  // GitHub's half-hourly check as it arrives: the :00 runs late under top-of-hour load, the :30
  // runs a little late, and one run (index 23) never comes. Minutes after the scheduled time.
  const DELAYS = [14, 4, 22, 6, 9, 3, 31, 9, 17, 5, 12, 2, 26, 7, 8, 4, 19, 3, 35, 8, 11, 5, 24, null,
                  16, 2, 9, 4, 28, 7, 13, 3, 21, 5, 7, 6, 33, 4, 15, 3, 10, 8, 25, 2, 18, 5, 12, 4];
  const EVENTS = [];
  DELAYS.forEach((d, i) => { if (d != null) EVENTS.push({ t: 30 * i + d, k: "stamp" }); });
  for (let t = 10; t <= 24 * 60; t += 10) EVENTS.push({ t, k: "watch" });    // pg_cron, */10
  EVENTS.sort((a, b) => a.t - b.t || (a.k === "stamp" ? -1 : 1));

  // What a rule with threshold T must count on that day: distinct stamps ever seen stale.
  const silences = (T) => {
    let last = 0; const seen = new Set();
    for (const e of EVENTS) {
      if (e.k === "stamp") last = e.t;
      else if (e.t - last >= T) seen.add(last);
    }
    return seen.size;
  };

  let counted = false;   // ops_heartbeat.counted_stamp exists from 0340 on
  const advance = async (mins) => {
    if (mins <= 0) return;
    await db.exec(`
      update public.ops_heartbeat set seen_at = seen_at - interval '${mins} minutes'
        ${counted ? `, counted_stamp = counted_stamp - interval '${mins} minutes'` : ""} where id = 1;
      update public.alerts set created_at = created_at - interval '${mins} minutes',
                               last_seen_at = last_seen_at - interval '${mins} minutes'
       where kind = 'heartbeat_stale';`);
  };
  const stamp = () => db.exec(`update public.ops_heartbeat set seen_at = now() where id = 1`);
  const watch = () => db.exec(`select public.heartbeat_watchdog()`);
  const replayDay = async () => {
    await stamp();
    let at = 0;
    for (const e of EVENTS) { await advance(e.t - at); at = e.t; if (e.k === "stamp") await stamp(); else await watch(); }
  };
  // Quiet for `mins`, the watchdog running every ten minutes throughout.
  const quietFor = async (mins) => { for (let m = 10; m <= mins; m += 10) { await advance(10); await watch(); } };
  const hb = async () => rows(`select id, title, body, severity, occurrences, ack_at, ack_by, created_at, last_seen_at
                                  from public.alerts where kind = 'heartbeat_stale' order by created_at`);
  const openHb = async () => (await hb()).filter((a) => a.ack_at === null);
  const pushes = async () => Number((await q1(`select count(*) n from public.test_pushes`)).n);

  // ── REPRODUCE: the jittery day, judged by 0327's thirty minutes ──────────────────────────────
  await db.exec(`delete from public.alerts where kind = 'heartbeat_stale'`);
  await replayDay();
  const day27 = await openHb();
  ok("0327: a monitor that never once stopped still produces an 'uptime' alert",
    day27.length === 1, day27.length);
  ok("0327: …counting a 'silence' every time the check was late — what the ×63 was made of",
    Number(day27[0]?.occurrences) === silences(30) && silences(30) >= 10, { db: day27[0]?.occurrences, expected: silences(30) });
  ok("0327: …under a title that says no monitor exists, which was false",
    /no uptime monitor/i.test(day27[0]?.title ?? ""), day27[0]?.title);
  ok("the day itself has no gap a 90-minute rule would call a silence", silences(90) === 0, silences(90));

  // ── THE CRASH ROWS 0303 RULED ON AND NEVER RESTATED ─────────────────────────────────────────
  // What the pre-0303 producer wrote (app/api/errors/report as of b6c923b): kind null, category
  // system, link /crew, title by fatality, body = the message and " · " and the path. The first two
  // are the two rows in Ryan's inbox; the rest are what must NOT be swept up with them.
  const crash = [
    { k: "jul16",   at: "2026-07-16 15:02:00+00", sev: "critical", kind: null, body: "module factory is not available · /menu", restate: true },
    { k: "sep6",    at: "2026-09-07 00:30:00+00", sev: "critical", kind: null, body: "Failed to load chunk /_next/static/chunks/0pfvpf_6yqhu-.js?dpl=dpl_AXuE7noGhgUrg8BQPrzp6uVDzLjQ from module 74850 · /crew", restate: true },
    { k: "webpack", at: "2026-08-01 12:00:00+00", sev: "critical", kind: null, body: "ChunkLoadError: Loading chunk 42 failed. · /reserve", restate: true },
    { k: "import",  at: "2026-08-02 12:00:00+00", sev: "critical", kind: null, body: "Importing a module script failed. · /shop", restate: true },
    // lib/deploySkew calls these skew too (REBUILT) — broad there because a wrong guess costs one
    // reload. Here a wrong guess would cost a real crash its alert, so they are left alone.
    { k: "rebuilt", at: "2026-08-03 12:00:00+00", sev: "critical", kind: null, body: "t.mixTotal is not a function · /reserve", restate: false },
    { k: "safari",  at: "2026-08-04 12:00:00+00", sev: "critical", kind: null, body: "undefined is not an object (evaluating 'o.mixTotal') · /reserve", restate: false },
    { k: "realbug", at: "2026-08-05 12:00:00+00", sev: "critical", kind: null, body: "Cannot read properties of null (reading 'market') · /plan", restate: false },
    { k: "api",     at: "2026-08-06 12:00:00+00", sev: "critical", kind: null, body: "Request failed with status 500 · /money", restate: false },
    // After 0303's producer: a critical skew row means three reloads failed. 0303 kept it critical on purpose.
    { k: "after",   at: "2026-09-20 12:00:00+00", sev: "critical", kind: null, body: "Failed to load chunk /_next/static/chunks/abc.js from module 1 · /crew", restate: false },
    // Someone else's critical that happens to mention a chunk, and an important that is one.
    { k: "kinded",  at: "2026-08-07 12:00:00+00", sev: "critical", kind: "ops_incident", body: "ChunkLoadError while sending · /crew", restate: false },
    { k: "notcrit", at: "2026-08-08 12:00:00+00", sev: "important", kind: null, body: "ChunkLoadError: Loading chunk 7 failed. · /crew", restate: false },
  ];
  for (const c of crash) {
    await db.exec(`insert into public.alerts (severity, category, title, body, link, kind, created_at)
      values ('${c.sev}', 'system', 'App error — a screen crashed', '${c.body.replace(/'/g, "''")}', '/crew',
              ${c.kind ? `'${c.kind}'` : "null"}, '${c.at}')`);
  }
  const crashRow = async (c) => q1(`select severity, ack_at, ack_by, title, body from public.alerts
                                     where body = '${c.body.replace(/'/g, "''")}' and created_at = '${c.at}'`);

  // ── AND THE SUBJECT THE DATABASE REFUSES ─────────────────────────────────────────────────────
  // alerts.subject_id is a uuid (0174). lib/errorIntake keyed its storm line on the business DAY and
  // the Square webhook keyed chargeback_open on Square's dispute id — neither is a uuid, the insert
  // fails, and raiseAlert swallows the failure by contract. So the critical "a card dispute was
  // opened" alert has never been able to exist. Shown here at the database; fixed in lib/serverAlerts.
  for (const [what, key] of [["a business day", "2026-10-04"], ["a Square dispute id", "XDgyFu7yo1E2S5lQGGpYn"]]) {
    let refused = null;
    try { await db.exec(`insert into public.alerts (severity, category, title, kind, subject_id)
                         values ('critical', 'money', 'x', 'probe', '${key}')`); }
    catch (e) { refused = String(e?.message ?? e); }
    ok(`alerts.subject_id refuses ${what} — the insert raiseAlert has been silently losing`,
      refused !== null && /uuid/i.test(refused), refused);
  }

  // ── APPLY 0340 ───────────────────────────────────────────────────────────────────────────────
  // 0340 restates the stalled-order alerts by running their producer, which reads v_shop_orders.
  // This world sells no merch, so it gets the view with no rows — the shape 0340 reads, nothing else.
  await db.exec(`create view public.v_shop_orders as
    select null::uuid as id, null::text as who, null::text as status, null::int as age_hours,
           null::int as total_cents, null::text as items, null::timestamptz as created_at,
           null::timestamptz as status_changed_at, false as waiting_on_us
     where false`);
  const pushesBefore = await pushes();
  await db.exec(readFileSync(join(ROOT, "supabase/migrations/0340_three_things_the_inbox_still_said.sql"), "utf8"));
  counted = true;
  ok("0340 applies against a real Postgres", true);
  ok("0340: applying it pushed nobody's phone", (await pushes()) === pushesBefore, (await pushes()) - pushesBefore);

  const retired = (await hb())[0];
  ok("0340: the ×N line is retired — acknowledged by the mechanism, kept for history",
    (await openHb()).length === 0 && retired?.ack_at !== null && retired?.ack_by === null, retired);

  for (const c of crash) {
    const r = await crashRow(c);
    if (c.restate) {
      ok(`0340: ${c.k} — restated to what 0303 decided this family is, and swept out of the feed`,
        r?.severity === "fyi" && r?.ack_at !== null && r?.ack_by === null, r);
      ok(`0340: ${c.k} — its title and body untouched: what it said is the record of what was shown`,
        r?.title === "App error — a screen crashed" && r?.body === c.body);
    } else if (c.sev === "critical") {
      ok(`0340: ${c.k} — left exactly as it was`, r?.severity === "critical" && r?.ack_at === null, r);
    } else {
      // Not restated. The sweep 0340 runs may still age a non-critical out — exactly what it would
      // have done at :17 — so what is asserted is that 0340 did not reclassify it.
      ok(`0340: ${c.k} — not reclassified`, r?.severity === c.sev, r);
    }
  }

  // THE KNOWN PAIR: 0340's signatures must be a SUBSET of what the app itself calls skew. The real
  // lib/deploySkew.ts is compiled and asked about every message above.
  const ts = (await import("typescript")).default;
  const mod = { exports: {} };
  new Function("module", "exports", "require",
    ts.transpileModule(readFileSync(join(ROOT, "lib/deploySkew.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  )(mod, mod.exports, () => ({}));
  const isSkew = mod.exports.isDeploySkew;
  ok("known pair: lib/deploySkew was compiled and found", typeof isSkew === "function");
  const claimedButNotSkew = crash.filter((c) => c.restate && !isSkew(c.body.replace(/ · \/[a-z]*$/, "")));
  ok("known pair: every message 0340 restates is one the app itself calls a stale build",
    claimedButNotSkew.length === 0, claimedButNotSkew.map((c) => c.k));
  ok("known pair: …and the REBUILT family the app guesses at is deliberately not claimed",
    isSkew("t.mixTotal is not a function") && !crash.find((c) => c.k === "rebuilt").restate);

  // ── THE SAME DAY, JUDGED BY THREE PERIODS ────────────────────────────────────────────────────
  await replayDay();
  ok("0340: the jittery day — late runs, a dropped one — raises nothing at all", (await hb()).length === 1, (await hb()).length);

  // ── A REAL SILENCE ───────────────────────────────────────────────────────────────────────────
  const p0 = await pushes();
  await stamp();                                            // the silence starts now
  await quietFor(80);
  ok("0340: eighty quiet minutes is still not a silence", (await openHb()).length === 0, (await openHb()).length);
  await quietFor(10);
  let open = await openHb();
  ok("0340: at ninety it is — one line", open.length === 1, open.length);
  ok("0340: …saying how long in minutes while it is under two hours", / — 9\d minutes, against/.test(open[0]?.body ?? ""), open[0]?.body);
  await quietFor(60);                                       // 150 minutes in all
  open = await openHb();
  ok("0340: …and in hours past that, rounded DOWN and said so", / — over 2 hours, against/.test(open[0]?.body ?? ""), open[0]?.body);
  ok("0340: …one push, not one per run", (await pushes()) === p0 + 1, (await pushes()) - p0);
  ok("0340: …important, as 0327 decided", open[0]?.severity === "important");
  ok("0340: …titled so it stays true after the check comes back", open[0]?.title === "The uptime check went quiet", open[0]?.title);
  ok("0340: …and it says what is true now that a monitor exists",
    /GitHub \(Actions › Production\)/.test(open[0]?.body ?? "") && /every half hour/.test(open[0]?.body ?? "")
    && !/no uptime monitor|wire one/i.test(open[0]?.body ?? ""), open[0]?.body);
  ok("0340: a continuous silence is one occurrence however many runs see it", Number(open[0]?.occurrences) === 1);
  ok("0340: last_seen_at now means one thing — the last run that found it quiet",
    Math.abs(new Date(open[0]?.last_seen_at).getTime() - Date.now()) < 60_000, open[0]?.last_seen_at);

  // ── IT COMES BACK ────────────────────────────────────────────────────────────────────────────
  await db.exec(`create table public.test_hb_writes (n int);
    create or replace function public.test_count_hb() returns trigger language plpgsql as $$
    begin if new.kind = 'heartbeat_stale' then insert into public.test_hb_writes values (1); end if; return new; end $$;
    create trigger test_count_hb after update on public.alerts for each row execute function public.test_count_hb();`);
  await stamp(); await advance(10); await watch();
  open = await openHb();
  ok("0340: when checks resume, the line stops saying nothing has checked",
    /^It went quiet after \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M ET and was still quiet at \d{1,2}:\d{2} [AP]M ET\. It has been checking in again since\./.test(open[0]?.body ?? ""), open[0]?.body);
  const writes = async () => Number((await q1(`select count(*) n from public.test_hb_writes`)).n);
  // No clock is moved here on purpose: the harness simulates time by shifting stored timestamps,
  // which would change the absolute times this text prints. In the real world nothing it prints
  // moves while checks are healthy (when it went quiet, when it was last seen quiet), and that is
  // the property under test — six healthy runs, zero writes.
  const w1 = await writes();
  for (let i = 0; i < 6; i++) { await stamp(); await watch(); }
  ok("0340: …written once — a healthy hour is not six updates to every open console", (await writes()) === w1, (await writes()) - w1);

  // ── DISMISSED, THEN IT HAPPENS AGAIN ─────────────────────────────────────────────────────────
  const U = (await q1(`insert into auth.users default values returning id`)).id;
  await db.exec(`insert into public.alert_reads (alert_id, user_id) values ('${open[0].id}', '${U}')`);
  const p1 = await pushes();
  await quietFor(120);
  open = await openHb();
  ok("0340: a new silence is counted on the same line", open.length === 1 && Number(open[0]?.occurrences) === 2, open);
  ok("0340: …and RE-SURFACES it for whoever dismissed the last one — Got it on a broadcast never sets ack_at",
    Number((await q1(`select count(*) n from public.alert_reads where alert_id = '${open[0].id}'`)).n) === 0);
  ok("0340: …without another push: same line, same story", (await pushes()) === p1, (await pushes()) - p1);
  ok("0340: …and the body is back to saying it is quiet", /^Nothing has checked \/api\/health since/.test(open[0]?.body ?? ""), open[0]?.body);

  // Cleared by a mechanism (the sweep, 0258), the next silence is a new line and a new push.
  await stamp(); await advance(10); await watch();
  await db.exec(`update public.alerts set ack_at = now() where kind = 'heartbeat_stale' and ack_at is null`);
  const p2 = await pushes();
  await quietFor(100);
  ok("0340: once a line is cleared, the next silence opens a new one and says so out loud",
    (await openHb()).length === 1 && (await pushes()) === p2 + 1);

  ok("0340: a stranger cannot run the watchdog", (await q1(
    `select has_function_privilege('anon', 'public.heartbeat_watchdog()', 'execute') a,
            has_function_privilege('authenticated', 'public.heartbeat_watchdog()', 'execute') b`)).a === false);

  ok("0340 recorded itself", (await q1(
    `select count(*)::int n from public.schema_migrations where version='0340_three_things_the_inbox_still_said'`)).n === 1);
}


// ── 0369: THE PASS ALERT RINGS UNTIL THE PASS IS CLEAR ─────────────────────────────────────────────
// 0336 made the pass's alert one line that cannot flood, and left three things wrong with it. Each is shown here
// first the way 0336 does it, then fixed:
//   1. a pre-order was counted from when it was placed, so one placed hours ahead of its stop rang ten minutes later;
//   2. the open line was only ever UPDATED, and a push fans out on INSERT (0157 — recorded in test_pushes above): one
//      ring, then silence for as long as the tickets waited, until an ack or 0258's sweep 21 days on;
//   3. it never closed: an empty pass went on saying tickets were waiting.
// Time passes the way it does above: every stored clock that matters is moved back. The orders table is the 0336
// block's, with 0343's ready_from added from its own file.
{
  await db.exec(readFileSync(join(ROOT, "supabase/migrations/0343_a_pre_order_says_when_it_is_made.sql"), "utf8"));
  await db.exec(`delete from public.alerts where kind = 'order_stale'; delete from public.orders;`);
  const pushes = async () => Number((await q1(`select count(*) n from public.test_pushes`)).n);
  const lines = async () => rows(`select id, title, ack_at, ack_by, created_at from public.alerts
                                   where kind = 'order_stale' order by created_at, id`);
  const open = async () => (await lines()).filter((a) => a.ack_at === null);
  const run = async () => Number((await q1(`select public.alert_stale_orders(10) as n`)).n);
  const later = (by) => {                                     // minutes, or an interval in words
    const iv = typeof by === "number" ? `${by} minutes` : by;
    return db.exec(`
    update public.orders set created_at = created_at - interval '${iv}', ready_from = ready_from - interval '${iv}';
    update public.alerts set created_at = created_at - interval '${iv}', last_seen_at = last_seen_at - interval '${iv}',
                             ack_at = ack_at - interval '${iv}'
     where kind = 'order_stale';`);
  };
  // A ticket placed `ago` minutes ago; `ahead`: placed that many minutes before its stop opens (0343's ready_from).
  const place = async (ago, ahead = null) => (await q1(`insert into public.orders (status, created_at, ready_from)
    values ('new', now() - interval '${ago} minutes',
            ${ahead === null ? "null" : `now() - interval '${ago} minutes' + interval '${ahead} minutes'`}) returning id`)).id;
  // pg_cron's */5, for `mins` minutes.
  const cron = async (mins) => { for (let m = 5; m <= mins; m += 5) { await later(5); await run(); } };

  // ── THE THREE, AS 0336 HAS THEM ──────────────────────────────────────────────────────────────
  const p0 = await pushes();
  await place(15, 180);                                       // a pre-order: its stop opens in 2h45m
  ok("0336: a pre-order placed three hours ahead of its stop counts as waiting fifteen minutes after it was placed",
    (await run()) === 1 && (await open()).length === 1 && (await pushes()) === p0 + 1, await lines());
  await cron(120);
  ok("0336: two more hours of it waiting, 24 runs — still the one line, and not one more push: it rang once",
    (await lines()).length === 1 && (await open()).length === 1 && (await pushes()) === p0 + 1,
    { lines: (await lines()).length, pushes: (await pushes()) - p0 });
  await db.exec(`update public.orders set status = 'done'`);
  ok("0336: the pass cleared, and the line still says a ticket is waiting", (await run()) === 0 && (await open()).length === 1);

  // ── 0369 ─────────────────────────────────────────────────────────────────────────────────────
  const sql369 = readFileSync(join(ROOT, "supabase/migrations/0369_the_pass_alert_rings_until_the_pass_is_clear.sql"), "utf8");
  const pApply = await pushes();
  await db.exec(sql369);
  ok("0369 applies against a real Postgres", true);
  const left = await lines();
  ok("0369: applying it closes the line the cleared pass left open — the producer runs once, as its restatement",
    (await open()).length === 0 && left.length === 1 && left[0].ack_at !== null, left);
  ok("0369: …closed by the mechanism (ack_by null), kept for history, and nobody's phone rang for it",
    left[0]?.ack_by === null && (await pushes()) === pApply, left[0]);

  // ── 1 · LATE FROM WHEN IT IS DUE ─────────────────────────────────────────────────────────────
  // THE KNOWN PAIR: the alert counts a ticket exactly when the pass's own clock says it is ten minutes in.
  // lib/ordering.ts is compiled and asked, ticket by ticket, beside the function itself.
  {
    const ts = (await import("typescript")).default;
    const mod = { exports: {} };
    new Function("module", "exports", "require",
      ts.transpileModule(readFileSync(join(ROOT, "lib/ordering.ts"), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    )(mod, mod.exports, () => ({}));
    const clockFrom = mod.exports.orderClockFrom;
    ok("known pair: lib/ordering was compiled and orderClockFrom found", typeof clockFrom === "function");
    // [placed, ready_from] in minutes ago (null: placed for now; negative: still to come).
    const cases = [[12, null], [12, -168], [12, 72], [9, 72], [180, 8], [180, 11], [12, 12]];
    const seen = [];
    for (const [placed, ready] of cases) {
      await db.exec(`delete from public.orders`);
      const o = await q1(`insert into public.orders (status, created_at, ready_from) values ('new',
        now() - interval '${placed} minutes', ${ready === null ? "null" : `now() - interval '${ready} minutes'`}) returning created_at, ready_from`);
      const due = Date.parse(clockFrom({ created_at: o.created_at.toISOString(), ready_from: o.ready_from ? o.ready_from.toISOString() : null }));
      seen.push({ placed, ready, pass: Date.now() - due >= 10 * 60e3, alert: (await run()) === 1 });
    }
    ok("known pair: the alert counts a ticket exactly when lib/ordering's orderClockFrom puts it ten minutes in — pre-orders, a ready_from before it was placed, and none",
      seen.every((s) => s.pass === s.alert) && seen.filter((s) => s.pass).length === 4, seen);
    await db.exec(`delete from public.alerts where kind = 'order_stale'; delete from public.orders;`);
  }
  const p1 = await pushes();
  await place(15, 180);
  ok("0369: the same pre-order — placed three hours ahead, fifteen minutes ago — does not ring",
    (await run()) === 0 && (await lines()).length === 0 && (await pushes()) === p1);
  await cron(170);                                            // its stop opened five minutes ago
  ok("0369: …nor on any run until its stop opens, nor five minutes after", (await lines()).length === 0 && (await pushes()) === p1);
  await cron(5);                                              // due for ten minutes
  ok("0369: …and once it has been due ten minutes it is waiting like any ticket: one line, one push",
    (await open()).length === 1 && (await pushes()) === p1 + 1 && /^🧾 1 order waiting on the pass$/.test((await open())[0]?.title ?? ""),
    await lines());

  // ── 2 · IT RINGS AGAIN WHILE TICKETS WAIT, A QUARTER HOUR APART ─────────────────────────────
  const p2 = await pushes();
  const first = (await open())[0];
  await later(5); await run();                                // five minutes after it rang
  await place(12);                                            // a second ticket nobody has started
  await later(5); await run();                                // ten
  let o = await open();
  ok("0369: between rings the open line is refreshed, not repeated (0336's dedupe) — one line, now counting two, no push",
    o.length === 1 && o[0].id === first.id && /2 orders waiting on the pass/.test(o[0].title) && (await pushes()) === p2,
    { o, pushes: (await pushes()) - p2 });
  await later(5); await run();                                // fifteen
  o = await open();
  const both = await lines();
  ok("0369: fifteen minutes after it rang and still waiting, it rings again — a fresh line, a fresh push",
    o.length === 1 && o[0].id !== first.id && (await pushes()) === p2 + 1, { o, pushes: (await pushes()) - p2 });
  ok("0369: …the line before closed by the mechanism (ack_by null) and kept — two lines, one open, never a pile",
    both.length === 2 && both[0].id === first.id && both[0].ack_at !== null && both[0].ack_by === null, both);
  const p3 = await pushes();
  await cron(60);
  ok("0369: an hour more of tickets waiting rings four times, a quarter hour apart — never more often, one line open",
    (await pushes()) === p3 + 4 && (await open()).length === 1 && (await lines()).length === 6,
    { pushes: (await pushes()) - p3, lines: (await lines()).length });

  // pg_cron starts a run a moment after its minute, so the run fifteen minutes on can find the last ring a hair under
  // fifteen minutes old. It still rings; a run a whole minute early does not.
  const pJ = await pushes();
  await later(5); await run(); await later(5); await run();   // ten minutes after the last ring
  await later(4); await run();                                // fourteen
  const notAt14 = (await pushes()) === pJ;
  await later("59 seconds"); await run();                     // 14:59
  ok("0369: the run that finds the last ring 14:59 old rings (pg_cron's start-up jitter); at 14:00 it did not",
    notAt14 && (await pushes()) === pJ + 1 && (await open()).length === 1, { notAt14, pushes: (await pushes()) - pJ });

  // "Got it" on a broadcast is one person's read (0157) and never closes the line, so the next ring is a new line —
  // and whoever dismissed the last one hears this one.
  const U = (await q1(`insert into auth.users default values returning id`)).id;
  const read = (await open())[0];
  await db.exec(`insert into public.alert_reads (alert_id, user_id) values ('${read.id}', '${U}')`);
  await cron(15);
  const next = (await open())[0];
  ok("0369: whoever tapped Got it on the line hears the next ring — it is a new line, one they have not read",
    next && next.id !== read.id && Number((await q1(`select count(*) n from public.alert_reads where alert_id = '${next.id}' and user_id = '${U}'`)).n) === 0);

  // 0174's cooldown, as 0336 kept it: a line somebody acknowledged stays down until fifteen minutes after it rang.
  await later(2);
  await db.exec(`update public.alerts set ack_at = now(), ack_by = '${U}' where kind = 'order_stale' and ack_at is null`);
  const p4 = await pushes();
  await later(3); await run();                                // five minutes after it rang
  const downAt5 = (await open()).length === 0 && (await pushes()) === p4;
  await later(5); await run();                                // ten
  ok("0369: acknowledged, the line does not come back five or ten minutes after it rang — the cooldown, kept",
    downAt5 && (await open()).length === 0 && (await pushes()) === p4);
  await later(5); await run();                                // fifteen
  ok("0369: …and fifteen minutes after it rang, a pass still waiting rings again", (await open()).length === 1 && (await pushes()) === p4 + 1);

  // ── 3 · AN EMPTY PASS CLOSES THE LINE ──────────────────────────────────────────────────────
  const p5 = await pushes();
  const was = (await open())[0];
  await db.exec(`update public.orders set status = 'preparing' where status = 'new'`);
  ok("0369: the tickets started, the run finds none waiting and closes the line", (await run()) === 0 && (await open()).length === 0);
  const closed = (await lines()).find((l) => l.id === was.id);
  ok("0369: …closed by the mechanism (ack_by null) and kept for history, with no push",
    closed?.ack_at !== null && closed?.ack_by === null && (await pushes()) === p5, closed);
  await place(20, 120);
  ok("0369: a pass holding only a pre-order whose stop has not opened is clear: nothing opens",
    (await run()) === 0 && (await open()).length === 0 && (await pushes()) === p5);
  await place(11);                                            // backed up again, the last ring moments ago
  await run();
  const heldAt0 = (await open()).length === 0 && (await pushes()) === p5;
  await cron(10);
  const heldAt10 = (await open()).length === 0 && (await pushes()) === p5;
  await cron(5);
  ok("0369: backed up again inside fifteen minutes of the last ring, it waits for the quarter hour and then rings — never two rings closer than that",
    heldAt0 && heldAt10 && (await open()).length === 1 && (await pushes()) === p5 + 1, { heldAt0, heldAt10, pushes: (await pushes()) - p5 });

  // ── WHO MAY RUN IT, AND RUNNING IT TWICE ──────────────────────────────────────────────────
  const g = await q1(`select has_function_privilege('anon', 'public.alert_stale_orders(int)', 'execute') a,
                             has_function_privilege('authenticated', 'public.alert_stale_orders(int)', 'execute') b`);
  ok("0369: a stranger cannot run it — not anon, not a signed-in browser", g.a === false && g.b === false, g);
  const def = await q1(`select prosecdef d, coalesce(proconfig::text, '') c from pg_proc where proname = 'alert_stale_orders'`);
  ok("0369: it runs as its definer with search_path pinned", def.d === true && /search_path=public/.test(def.c), def);
  const before = { lines: (await lines()).length, pushes: await pushes() };
  let rerun = null;
  try { await db.exec(sql369); } catch (e) { rerun = String(e?.message ?? e); }
  ok("0369 run again: no error, no second changelog line, and no ring — the line just rung is only refreshed",
    rerun === null
    && Number((await q1(`select count(*) n from public.changelog where title = 'The pass alert rings until the pass is clear'`)).n) === 1
    && (await pushes()) === before.pushes && (await lines()).length === before.lines && (await open()).length === 1,
    { rerun, pushes: (await pushes()) - before.pushes, lines: (await lines()).length - before.lines });
  ok("0369 recorded itself, once per run", Number((await q1(
    `select applied_count from public.schema_migrations where version = '0369_the_pass_alert_rings_until_the_pass_is_clear'`)).applied_count) === 2);
}

console.log(`AN ALERT THAT CRIES WOLF: ${pass} passed, ${fail} failed`);
console.log(`0157 + 0255 + 0258 + 0327 + 0333 + 0336 + 0340 + 0343 + 0369 executed against a real Postgres.\n`);
process.exit(fail ? 1 : 0);
