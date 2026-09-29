-- ── AN ALERT THAT CRIES WOLF ───────────────────────────────────────────────────────────────────
-- 2026-09-29. Ryan sold the first flagship cap. The alert telling him so was the FIFTH item in his
-- inbox, under four copies of "App heartbeat lost" — and the inbox read 24 · 20 CRITICAL, of which
-- nearly all were that same alert repeating: 1h, 2h, 4h, 10h, Sep 12, Sep 11, Sep 11, Sep 9.
--
-- ── WHY IT LOOPS, AND WHY THAT IS NOT A BUG IN THE DEDUPE ──────────────────────────────────────
-- 0255's guard is correct and works: one alert per outage, re-arming only after a fresh stamp. The
-- problem is upstream of it, and 0255's own comment called this shot on the day it shipped:
--
--     "until a monitor (or anyone) actually hits /api/health, the watchdog sends its one
--      'heartbeat lost' email. That first email is a feature: it proves the whole alert→email
--      chain live AND points out the monitor isn't wired yet."
--
-- The monitor was never wired. So the stamp only lands when a person opens the app or a developer
-- curls /api/health — and then goes stale 30 minutes later, which re-arms the guard and fires
-- again. Every visit manufactures a fresh "outage". Two months of that is 20 critical alerts about
-- a monitor that does not exist, and an owner who has learned that his critical alerts are noise.
--
-- That is the expensive part. Not the alert — the training.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────────────────────────
-- The alert stops repeating and starts counting. A second occurrence updates the existing open row
-- with a tally and a fresh timestamp instead of inserting a new one, so a recurring condition is
-- ONE line in the inbox that says how many times, not twenty lines that say the same thing.
--
-- And it stops overstating itself. "App heartbeat lost" reads as "the app is down". The app is not
-- down — this alert cannot even be raised unless the database is up enough to run it. It says what
-- it means now: nobody is watching.

alter table public.alerts add column if not exists occurrences int not null default 1;
alter table public.alerts add column if not exists last_seen_at timestamptz;

comment on column public.alerts.occurrences is
  'How many DISTINCT episodes of this condition have folded into one open alert. Distinct matters: the watchdog runs every 10 minutes, so counting every run would put 144 on a single quiet day and turn the tally into the same noise it replaced. last_seen_at holds the heartbeat value already counted, so an ongoing outage counts once and a NEW one counts again.';

create or replace function public.heartbeat_watchdog() returns void
language plpgsql security definer set search_path = public as $$
declare
  hb  timestamptz;
  ack boolean;
  open_id uuid;
begin
  select seen_at into hb from public.ops_heartbeat where id = 1;
  if hb is null or hb > now() - interval '30 minutes' then return; end if;

  -- An UNREAD alert of this kind absorbs the recurrence. Once it is acknowledged the next stale
  -- stretch opens a new one — an owner who has cleared it is asking to be told again.
  select a.id into open_id
    from public.alerts a
   where a.kind = 'heartbeat_stale'
     and a.ack_at is null
   order by a.created_at desc
   limit 1;

  if open_id is not null then
    -- COUNT EPISODES, NOT RUNS. pg_cron fires this every 10 minutes; incrementing on each one puts
    -- 144 on the counter in a quiet day and the number stops meaning anything — the flood in a
    -- different shape. last_seen_at holds the heartbeat stamp already counted, so a continuous
    -- outage counts ONCE and only a genuinely new stale stretch (the stamp moved, then went quiet
    -- again) counts again.
    update public.alerts
       set occurrences  = occurrences + (case when last_seen_at is null or hb > last_seen_at then 1 else 0 end),
           last_seen_at = greatest(coalesce(last_seen_at, hb), hb),
           body = 'Nothing has checked /api/health since '
                  ||to_char(hb at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM')||' ET. '
                  ||'This is NOT the app being down — the database is up enough to run this check. '
                  ||'It means no uptime monitor is pinging /api/health, so a real outage would go '
                  ||'unnoticed. Wire one at any uptime service and this goes quiet for good.'
     where id = open_id;
    return;
  end if;

  insert into public.alerts (severity, category, title, body, link, kind, last_seen_at)
  values (
    -- Downgraded on purpose. A missing monitor is a real gap and worth fixing, but it is not the
    -- same class of event as a payment failing, and calling it critical twenty times is what
    -- taught an owner to scroll past the word.
    'important', 'system', 'No uptime monitor is watching the app',
    'Nothing has checked /api/health since '
      ||to_char(hb at time zone 'America/New_York', 'Dy Mon DD, HH12:MI AM')||' ET. '
      ||'This is NOT the app being down — the database is up enough to run this check. '
      ||'It means no uptime monitor is pinging /api/health, so a real outage would go unnoticed. '
      ||'Wire one at any uptime service and this goes quiet for good.',
    -- last_seen_at is the heartbeat stamp this alert is ABOUT, not the wall clock — it is what the
    -- next run compares against to decide whether anything new has happened.
    '/crew', 'heartbeat_stale', hb
  );
end $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A repeating alert is now one line with a count','fix','Ops',
   'The first shop order''s alert arrived fifth in the inbox, under four copies of the same heartbeat warning — twenty of the twenty-four alerts waiting were that one condition repeating. A recurring alert now updates a single line with a tally instead of adding another copy, and the heartbeat one says what it actually means: no uptime monitor is watching, which is not the same as the app being down.',
   '2026-09-29', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 where exists (select 1 from public.changelog c where c.title = v.title));

select public.record_migration('0327_an_alert_that_cries_wolf',
  'alerts.occurrences + heartbeat_watchdog rewrite. 0255''s dedupe was correct; the monitor it assumed was never wired, so every visit to the app manufactured a fresh outage and re-armed it — 20 critical alerts in two months, all one non-event, burying the first sale. Recurrences now fold into the open row with a count, and the alert is downgraded and renamed because it was never about the app being down.');

-- verify:
--   select kind, title, severity, occurrences, last_seen_at, ack_at
--     from public.alerts where kind = 'heartbeat_stale' order by created_at desc limit 5;
--   select public.heartbeat_watchdog();   -- twice: the second must NOT add a row
--   select count(*) from public.alerts where kind = 'heartbeat_stale' and ack_at is null;
