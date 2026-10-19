-- ── 0440 — THE SCHEDULED CHECK IS JUDGED BY THE GAP IT KEEPS ─────────────────────────────────────────────────────
-- 2026-10-19. R41 (Ryan, 2026-10-19: an outside monitor for the site's uptime, and six hours for GitHub's check). Paste
-- into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. heartbeat_watchdog (0255, 0327, 0340) opens "The uptime check went quiet" when nothing has stamped /api/health
-- for 90 minutes — three periods of production.yml's half-hourly schedule. GitHub doesn't keep that schedule: from
-- 2026-10-02 to 10-19 it ran 101 scheduled checks where the schedule names about 800 — one every two to six hours, the
-- longest gap 5h 45m — so the line opened and closed again on most days about a check that was doing what GitHub lets
-- it. A line that is usually false is one nobody reads: 0327's lesson, again.
--
-- WHAT. Whether the site is up is said from outside it now, every three minutes, by an uptime monitor that emails the
-- owner itself (RELEASE.md, "The outside monitor") — it answers even when the database can't, which this line never
-- could. This watchdog watches what only it can: that GitHub's deeper check — the ledger, the push function, the probes,
-- every route painted — still runs at all. It waits six hours, longer than any gap GitHub has kept, and its line says
-- what it is about. The title stays (the push function's policy names it: no deploy for a sentence). The line open now,
-- if one is, was opened by the rule this replaces, and is retired as 0340 retired the last.
--
-- set lock_timeout (database F16): one function replaced; the watchdog's own open line updated.
-- existing rows: an open heartbeat_stale line is acknowledged — ack_at now, ack_by null (a mechanism, not a person).
-- changelog: none — fewer false lines in the inbox is not a screen anyone opens.

set lock_timeout = '5s';

-- heartbeat-stale-after: 360
-- scripts/smoke.cjs reads that marker and production.yml's quick schedule: it fails unless the number is at least three of
-- the schedule's periods and at least six hours — GitHub's longest measured gap (5h 45m, 2026-10-02 to 10-19) under it.
create or replace function public.heartbeat_watchdog() returns void
language plpgsql security definer set search_path = public as $$
declare
  hb         timestamptz;
  counted    timestamptz;
  open_id    uuid;
  last_quiet timestamptz;
  v_back     text;
  quiet      interval;
  quiet_in   text;
  et         constant text := 'America/New_York';
begin
  select seen_at, counted_stamp into hb, counted from public.ops_heartbeat where id = 1;
  if hb is null then return; end if;

  -- last_seen_at is "when this was last true" (alert_open_once writes the wall clock), so for this
  -- kind it is the last run that found the check quiet.
  select a.id, a.last_seen_at into open_id, last_quiet
    from public.alerts a
   where a.kind = 'heartbeat_stale' and a.subject_id is null and a.ack_at is null
   order by a.created_at desc
   limit 1;

  if hb > now() - interval '360 minutes' then
    -- Checking in. An open line from an earlier silence must stop saying "nothing has checked" —
    -- that sentence is now false. Written once: the text carries no clock that moves.
    if open_id is not null then
      v_back := 'GitHub''s check went quiet after '
        || to_char(coalesce(counted, hb) at time zone et, 'Dy, Mon FMDD, FMHH12:MI AM')
        || ' ET and was still quiet at '
        || to_char(coalesce(last_quiet, now()) at time zone et, 'FMHH12:MI AM')
        || ' ET. It has been running again since. Nothing to do unless it repeats — the count '
        || 'on this line says how often it has.';
      update public.alerts a set body = v_back
       where a.id = open_id and a.body is distinct from v_back;
    end if;
    return;
  end if;

  quiet := now() - hb;
  -- Past two hours the number is rounded DOWN, and the word "over" says so.
  quiet_in := case
    when quiet < interval '2 hours'  then floor(extract(epoch from quiet) / 60)::int               || ' minutes'
    when quiet < interval '48 hours' then 'over ' || floor(extract(epoch from quiet) / 3600)::int  || ' hours'
    else                                  'over ' || floor(extract(epoch from quiet) / 86400)::int || ' days'
  end;

  -- 'important', as 0327 decided: a check that has stopped is a gap worth fixing, not a payment failing. The title is
  -- past tense so it stays true after the check comes back.
  perform public.alert_open_once(
    'heartbeat_stale', null, 'important', 'system',
    'The uptime check went quiet',
    'GitHub''s production check hasn''t reached /api/health since '
      || to_char(hb at time zone et, 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET — ' || quiet_in
      || '. GitHub runs it every few hours (Actions › Production), never six apart until now: its schedule has stopped — '
      || 'GitHub pauses it after 60 days without a push — or its runs can''t reach the app and are red. Whether the site '
      || 'itself is up is the outside monitor''s to say: it emails you within minutes when it isn''t. The database is up: '
      || 'this line could not exist otherwise.',
    '/crew');

  -- COUNT SILENCES, NOT RUNS (0327's rule, kept): a new silence is a stamp this watchdog has not counted, and it
  -- re-surfaces the line for everyone who dismissed the last one (0340).
  if open_id is not null and counted is distinct from hb then
    update public.alerts set occurrences = occurrences + 1 where id = open_id;
    delete from public.alert_reads where alert_id = open_id;
  end if;

  update public.ops_heartbeat set counted_stamp = hb where id = 1 and counted_stamp is distinct from hb;
end $$;

revoke all on function public.heartbeat_watchdog() from public, anon, authenticated;

comment on function public.heartbeat_watchdog() is
  'Raises ONE important alert (alert_open_once, kind heartbeat_stale, no subject) when GitHub''s production check (production.yml, which stamps /api/health with HEALTH_PROBE_SECRET) has not checked in for 6 hours — longer than any gap GitHub has kept between its scheduled runs (0440). The site''s own uptime is an outside monitor''s (RELEASE.md). Counts distinct silences via ops_heartbeat.counted_stamp, re-surfaces the line for everyone on a new one, and rewrites it to say so when the check resumes.';

-- THE LINE ALREADY IN THE INBOX, if there is one: opened by the 90-minute rule this replaces, about a check that was
-- running as often as GitHub lets it. Retired, not restated.
update public.alerts
   set ack_at = now()
 where kind = 'heartbeat_stale'
   and ack_at is null;

-- verify (numbers and booleans only):
--   select prosrc like '%360 minutes%' from pg_proc where proname = 'heartbeat_watchdog';                          -- t
--   select has_function_privilege('anon', 'public.heartbeat_watchdog()', 'execute');                               -- f
--   select count(*) from public.alerts where kind = 'heartbeat_stale' and ack_at is null;                          -- 0
select public.record_migration('0440_the_scheduled_check_is_judged_by_the_gap_it_keeps');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
