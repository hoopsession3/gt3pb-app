-- ── THE FIX SHIPPED AND THE FLOOD STAYED ───────────────────────────────────────────────────────
-- 2026-09-30. 0327 was written yesterday because Ryan's first flagship sale arrived FIFTH in his
-- inbox, under four copies of the same heartbeat warning, in a feed reading "24 · 20 CRITICAL".
-- It diagnosed that correctly, downgraded the alert to 'important', and made recurrences fold into
-- one counted row instead of adding another copy. All of that is right and all of it works.
--
-- The inbox today, read out of production before writing a line of this:
--
--     50 unacked alerts.  40 of them critical.  32 of those 40 are ONE non-event.
--
-- 0327 changed what the producer writes FROM THEN ON. The 32 rows already sitting in the feed kept
-- severity = 'critical' — and 0258's hourly sweep, the one mechanism that could have cleared them,
-- exempts criticals on purpose:
--
--     "CRITICALS NEVER AUTO-EXPIRE — they email, they escalate, and silencing one is a human's
--      call, not a timer's."                                              — 0258, 2026-07-30
--
-- That rule is correct and stays. But it means those 32 rows are not stuck for 21 days. They are
-- stuck FOREVER, at any age, by a design decision that was never meant to apply to them — because
-- 0327 had already ruled that this alert is not critical.
--
-- So the header of 0327 is still an accurate description of the product. It fixed the faucet and
-- left the flood, and the sentence it opens with is still true of the inbox it was written about.
--
-- ── THE GENERAL SHAPE, WHICH THIS REPO ALREADY LEARNED ONE MIGRATION AGO ────────────────────────
-- A migration that corrects a producer and not the rows the producer already wrote leaves the
-- product broken in precisely the way the migration was written to fix. 0331 did this right — it
-- re-emitted 0329's function AND restated the alerts already carrying the broken link. 0327, two
-- migrations earlier, did not. The gate added alongside this one (scripts/smoke.cjs) makes the
-- omission impossible to repeat silently: a migration that re-emits an alert producer must either
-- restate the existing rows or say in one line why none need it.
--
-- ── WHAT THIS DOES, AND THE THREE THINGS IT DELIBERATELY DOES NOT ──────────────────────────────
-- DOES: restates the heartbeat rows to the severity and title 0327 already decided they should
-- have, then folds them into one line carrying the true episode count — 0327's own contract,
-- applied to 0327's own output.
--
-- DOES NOT touch any other kind. There are 8 further unacked criticals here (4 with no kind at all,
-- 3 task_assigned, 1 shop_order_stalled). Not one of them has been ruled non-critical by anything,
-- and quietly clearing an owner's critical alerts because they are old is the opposite of the job.
-- They are SURFACED instead, by the view below.
--
-- DOES NOT delete. ack_at, exactly as 0258 does it, with ack_by left null: the row stays for
-- history and reporting, it just leaves the live feed — the same thing tapping "Got it" does. A
-- null ack_by is already this app's way of saying a mechanism cleared it, not a person.
--
-- DOES NOT change 0258's rule, 0327's function, or the meaning of 'critical'.

-- ── 1 · RESTATE WHAT 0327 ALREADY DECIDED ──────────────────────────────────────────────────────
-- Done FIRST and independently of the fold, so the repair does not depend on it. Even if every
-- following statement were removed, these rows would now age out on their own through 0258 —
-- because after this they are what 0327 says they are.
--
-- The body is deliberately left alone. heartbeat_watchdog rewrites the open row's body every ten
-- minutes with the current stamp, and the rows being folded are history: what they said at the time
-- is the record of what Ryan was shown.
update public.alerts
   set severity = 'important',
       title    = 'No uptime monitor is watching the app'
 where kind = 'heartbeat_stale'
   and ack_at is null
   and (severity <> 'important' or title <> 'No uptime monitor is watching the app');

-- ── 2 · FOLD THEM INTO THE ONE LINE 0327 PROMISED ──────────────────────────────────────────────
-- Idempotent by construction: after this runs there is exactly one unacked row of this kind, so a
-- second run sums a single row into itself and acknowledges nothing. That is worth stating because
-- a fold that double-counts on re-run would inflate the very number it exists to make honest.
do $$
declare
  keep_id uuid;
  total   int;
  folded  int;
begin
  -- The newest survives: heartbeat_watchdog finds the open row with `order by created_at desc`, so
  -- keeping any other row would leave the watchdog writing into a row this migration just closed.
  select a.id into keep_id
    from public.alerts a
   where a.kind = 'heartbeat_stale' and a.ack_at is null
   order by a.created_at desc
   limit 1;

  if keep_id is null then return; end if;   -- nothing open; nothing to fold

  -- Summed BEFORE anything is acknowledged. occurrences counts distinct EPISODES (0327's comment
  -- on the column), and every row here was a distinct episode by definition — the pre-0327 producer
  -- could only make a new row when the previous stretch had ended.
  select coalesce(sum(a.occurrences), 0) into total
    from public.alerts a
   where a.kind = 'heartbeat_stale' and a.ack_at is null;

  update public.alerts
     set ack_at = now()
   where kind = 'heartbeat_stale' and ack_at is null and id <> keep_id;
  get diagnostics folded = row_count;

  update public.alerts
     set occurrences  = greatest(total, 1),
         last_seen_at = coalesce(last_seen_at, now())
   where id = keep_id;

  raise notice 'heartbeat_stale: folded % row(s) into %, occurrences = %', folded, keep_id, total;
end $$;

-- ── 3 · IS THE FEED READABLE? ONE PLACE THAT ANSWERS IT ────────────────────────────────────────
-- Nothing in this app could answer that question, which is why two months of it going wrong was
-- only ever noticed by a person scrolling. Every number here is one somebody had to compute by hand
-- tonight to find this bug.
--
-- feed-window: 30
-- That marker is not decoration. lib/useMyAlerts.ts fetches the feed with .limit(30), so an unacked
-- alert past the thirtieth is not merely low in the list — it is not fetched, not counted in the
-- badge, and cannot be acknowledged from any screen. A critical alert that no timer will expire and
-- no screen will show is the worst row this table can hold, so it gets its own column. The gate in
-- scripts/smoke.cjs reads the number out of BOTH files and fails if they ever disagree.
create or replace view public.v_alert_feed_health with (security_invoker = on) as
with u as (
  select * from public.alerts where ack_at is null
), ranked as (
  select id, severity, row_number() over (order by created_at desc) as rn from u
), by_kind as (
  select coalesce(kind, '(no kind)') as kind, count(*) as n from u group by 1 order by n desc limit 1
)
select
  (select count(*) from u)::int                                              as unacked,
  (select count(*) from u where severity = 'critical')::int                  as criticals,
  -- Criticals are exempt from 0258 at EVERY age, so this is not "will expire soon" — it is the
  -- count that has already outlived the longest window any other severity gets, and therefore the
  -- count that is only ever going to grow unless a person clears it.
  (select count(*) from u where severity = 'critical'
      and created_at < now() - interval '21 days')::int                      as criticals_past_every_window,
  -- Written unacknowledged, beyond the fetch, invisible. See feed-window above.
  (select count(*) from ranked where rn > 30)::int                           as beyond_the_feed_window,
  (select count(*) from ranked where rn > 30 and severity = 'critical')::int as criticals_nobody_can_see,
  (select kind from by_kind)                                                 as loudest_kind,
  (select n from by_kind)::int                                               as loudest_kind_rows,
  case
    when (select count(*) from u) = 0 then 'Empty.'
    -- Ordered worst-first on purpose: an invisible critical outranks a noisy feed, because the
    -- noisy feed is at least readable.
    when (select count(*) from ranked where rn > 30 and severity = 'critical') > 0
      then 'Critical alerts exist that no screen fetches and no timer clears.'
    when (select n from by_kind) * 2 > (select count(*) from u)
      then 'More than half of this feed is one repeating condition: '||(select kind from by_kind)||'.'
    when (select count(*) from u where severity = 'critical'
            and created_at < now() - interval '21 days') > 0
      then 'Criticals here have outlived every expiry window. Only a person can clear them.'
    else 'Readable.'
  end                                                                        as verdict;

revoke all on public.v_alert_feed_health from anon;
grant select on public.v_alert_feed_health to authenticated;

comment on view public.v_alert_feed_health is
  'Whether the alert feed is still readable, which nothing could answer before 0333. Every column here is a number somebody computed by hand on 2026-09-30 to discover that 32 of 50 unacked alerts were one non-event that no timer would ever clear. beyond_the_feed_window counts rows lib/useMyAlerts.ts never fetches — invisible, not merely low.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The alert inbox is readable again','fix','Ops',
   'Yesterday''s fix stopped the heartbeat warning from repeating, but the thirty-two copies already in the inbox kept their old "critical" rating — and critical alerts are deliberately never cleared by a timer, so they were going to sit there permanently, burying the one alert about a real paid order. They are now folded into a single line carrying how many times it happened, and the app can finally tell you when its own alert feed has stopped being worth reading.',
   '2026-09-30', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0333_the_fix_shipped_and_the_flood_stayed',
  '0327 downgraded the heartbeat alert to important and folded recurrences, but only for rows written after it. The 32 already in the feed kept severity=critical, which 0258 exempts from expiry ON PURPOSE and FOREVER — so 0327''s own opening complaint (a real sale arriving fifth under heartbeat copies) was still true of production tonight: 50 unacked, 40 critical, 32 of them one non-event. This restates those rows to what 0327 already decided they are, folds them into the single counted line 0327 promised, and adds v_alert_feed_health because nothing in the app could answer "is this feed still readable". Other unacked criticals are deliberately NOT touched — clearing an owner''s criticals because they are old is the opposite of the job; they are surfaced instead.');

-- verify:
--   select * from public.v_alert_feed_health;
--   select severity, count(*) from public.alerts where kind='heartbeat_stale' and ack_at is null group by 1;
--     -- exactly one row, and it must read 'important'
--   select occurrences, last_seen_at, title from public.alerts where kind='heartbeat_stale' and ack_at is null;
--   select count(*) from public.alerts where ack_at is null and severity='critical';
--     -- 8: the criticals this migration deliberately left alone
