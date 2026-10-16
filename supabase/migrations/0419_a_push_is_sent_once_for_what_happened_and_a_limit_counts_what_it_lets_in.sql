-- ── 0419 — A PUSH IS SENT ONCE, FOR WHAT HAPPENED; A LIMIT COUNTS WHAT IT LETS IN; A JOB THAT FAILS IS SAID ──────────
-- 2026-10-16. R10 of the customer audit — the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for 10/10 best
-- practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · The push function is reached with the public key every page carries (0157: the webhook's bearer is the
--     publishable key, which only gets past the platform's gate), and it acted on whatever row the request described: a
--     "critical" with any title emailed every admin from the business's own address with a link of the sender's choosing,
--     a "GT3 is LIVE" went to every subscriber, a "New order" rang every crew phone. The function now reads each row it is
--     told about from the database with the service role and sends from that — an event the database cannot show is not
--     sent, nor one whose own stamp says it is old news — and records each event it sends here (push_sent), so the same
--     event told twice is sent once. "The truck went live" had no stamp of its own: a request describing the flip while the
--     truck was live would have rung every subscriber again each half hour.
--   · rate_limit_hit (0154) counted the tries it refused, so one caller past its own limit used up the count every
--     caller shares (checkout's sixty a minute, the card doors' hundred and twenty) and a script from one address shut
--     card checkout for everyone. Its tidy-up deleted any window that started more than an hour ago — and a day's window
--     starts at midnight, so a per-day count (texts to a number, a booking's email) went back to zero at one in the
--     morning, and again every twenty calls after. And the one-off keys (an address, a card) were never swept at all.
--   · keep_app_push_token (0367) took a new phone signed out, without a count; 0418 counted only the web's door.
--   · push_subscriptions had no index the sends use: every crew ring and every member's notice read the whole table.
--   · Twenty-six scheduled jobs run inside the database and nothing read how they ran: a job failing every run (the
--     escalation of a critical, the release of a hold) said nothing anywhere, and cron's run log was never pruned.
--
-- WHAT.
--   · push_sent — one row per event sent (its key: what happened and to which row), the service role's alone; a row
--     older than ninety days is swept nightly.
--   · live_status.live_since — when the truck last went live, stamped by the database alone (a trigger on every write:
--     set on the flip to live, kept while live, cleared on going offline), so the push function can tell a flip that just
--     happened from one described again.
--   · rate_limit_hit — a try over the cap is refused and not counted; the windows swept are the ones that have ended
--     (any window of the bucket before the current one); a nightly sweep takes every bucket's windows older than two
--     days (the longest window is a day).
--   · keep_app_push_token — a new phone nobody is signed in on is counted with the web's (push:new-guest, 300 an hour
--     for everyone together, 0418). A member's is not: theirs replaces their other phones.
--   · three partial indexes on push_subscriptions: by member, the crew's by business, and the go-live list by business.
--   · cron_watch() — every ten minutes: a job with failed runs in the last twenty minutes raises one alert for that job
--     (kind cron_failed; alert_open_once, so a job failing every run is one open alert, its words kept current); cron's
--     run log keeps a week.
-- existing rows: cron_watch — new here; it has written nothing yet. live_since — left empty on every row: a truck live
--   when this is pasted went live before anything stamped it, and is not news (its next go-live is stamped).
-- changelog: below.

-- ── what the push function has sent ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_sent (
  event_key text primary key check (char_length(event_key) between 3 and 200),
  sent_at   timestamptz not null default now()
);
alter table public.push_sent enable row level security;   -- no policy: the push function's (service role) alone
revoke all on public.push_sent from public, anon, authenticated;
grant select, insert, delete on public.push_sent to service_role;
create index if not exists push_sent_at_idx on public.push_sent (sent_at);
comment on table public.push_sent is
  'One row per event the push function sent (0419): its key names what happened and to which row (orders:new:<id>, alert:<id>, …). The function reads each row it is told about from the database and sends once per key, so an event described twice — or by someone holding the public key — is sent at most once, and only if the database shows it.';

-- ── the truck going live, stamped by the database ───────────────────────────────────────────────────────────────────
alter table public.live_status add column if not exists live_since timestamptz;
create or replace function public.stamp_live_since() returns trigger language plpgsql set search_path = public as $$
begin
  -- Written here alone, on every write: a client's own value for it is never kept.
  if tg_op = 'INSERT' then
    new.live_since := case when new.is_live then now() else null end;
  elsif new.is_live and not coalesce(old.is_live, false) then
    new.live_since := now();
  elsif new.is_live then
    new.live_since := old.live_since;
  else
    new.live_since := null;
  end if;
  return new;
end $$;
drop trigger if exists a_live_since on public.live_status;
create trigger a_live_since before insert or update on public.live_status
  for each row execute function public.stamp_live_since();
comment on column public.live_status.live_since is
  'When the truck last went live (0419), stamped by the database alone (stamp_live_since): the push function sends the go-live ping only while this is minutes old.';

-- ── a limit counts what it lets in ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_limit_hit(p_bucket text, p_window_ms int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  if p_max is null or p_max < 1 or p_window_ms is null or p_window_ms < 1 then return false; end if;
  w := to_timestamp(floor(extract(epoch from now()) * 1000 / p_window_ms) * p_window_ms / 1000.0);
  -- 0419: a try over the cap is refused and NOT counted — one caller past its own limit no longer spends the count
  -- every caller shares. Under the cap the count goes up one, atomically (the conflict serializes concurrent tries).
  insert into public.rate_limit_hits as h (bucket, window_start, count) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set count = h.count + 1 where h.count < p_max
    returning h.count into n;
  -- 0419: the windows of this bucket that have ENDED — every one before the current window. A window started more than
  -- an hour ago was swept before, and a day's window starts at midnight: its count went at one in the morning.
  if random() < 0.05 then
    delete from public.rate_limit_hits where bucket = p_bucket and window_start < w;
  end if;
  return n is not null;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
comment on function public.rate_limit_hit(text, int, int) is
  'Count one try in a fixed window and say whether it fits (0154; 0419): true is under the cap. A try over the cap is refused and not counted; a bucket''s ended windows are swept as it is used, and every bucket''s older than two days nightly (sweep_rate_limits).';

create or replace function public.sweep_rate_limits() returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- The longest window any caller uses is a day: two days back holds nothing that still counts.
  delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sweep_rate_limits() from public, anon, authenticated;

-- ── a new phone signed out is counted ───────────────────────────────────────────────────────────────────────────────
create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  -- 0419: a new phone nobody is signed in on is counted with the web's (0418's push:new-guest — three hundred an hour,
  -- for everyone together). A member's is not: theirs replaces their other phones (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = v_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin)
  values (v_endpoint, 'apns', null, null, v_user, true)          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true;
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

-- ── the sends' own indexes ─────────────────────────────────────────────────────────────────────────────────────────
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (user_id) where user_id is not null;
create index if not exists push_subscriptions_crew_idx on public.push_subscriptions (tenant_id) where is_admin;
create index if not exists push_subscriptions_live_idx on public.push_subscriptions (tenant_id) where wants_live;

-- ── a job that fails is said ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cron_watch() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select j.jobname, count(*) as fails, max(d.end_time) as last_at,
           (array_agg(left(coalesce(d.return_message, ''), 160) order by d.end_time desc))[1] as said
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.end_time > now() - interval '20 minutes'
     group by j.jobname
  loop
    -- One open alert per job (alert_open_once: a job failing every run is one alert, its count going up), named by the
    -- job — the subject is the job's name made a uuid, so the same job is the same alert.
    perform public.alert_open_once('cron_failed', md5('cron:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job is failing — ' || r.jobname,
      r.fails || ' failed run' || case when r.fails = 1 then '' else 's' end || ' in the last 20 minutes. The last said: '
        || coalesce(nullif(btrim(r.said), ''), '(nothing)'),
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;
  -- The run log keeps a week (it grew by thousands of rows a day and was never pruned).
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return n;
end $$;
revoke all on function public.cron_watch() from public, anon, authenticated;
comment on function public.cron_watch() is
  'Every ten minutes (0419): a scheduled job with failed runs in the last twenty minutes raises one alert for that job (kind cron_failed, one open per job), and the run log keeps a week.';

-- ── the schedules ──────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin perform cron.unschedule('push-sent-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('rate-limit-sweep'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('cron-watch'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('push-sent-sweep', '17 7 * * *', $q$delete from public.push_sent where sent_at < now() - interval '90 days'$q$);
  perform cron.schedule('rate-limit-sweep', '23 7 * * *', 'select public.sweep_rate_limits()');
  perform cron.schedule('cron-watch', '*/10 * * * *', 'select public.cron_watch()');
exception when others then
  raise notice '0419: pg_cron is not here — run select public.cron_watch() and select public.sweep_rate_limits() by hand.';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A push is sent once, for what happened', 'security', 'Crew',
   'The app''s push sender reads every order, alert and notice it is told about from the database before it sends, and sends each one once — a made-up request, or the same one sent twice, rings nobody and emails nobody.',
   '2026-10-16', false),
  ('A busy door no longer closes for everyone', 'fix', 'Ordering',
   'Limits count what they let through: one person or script past its own limit no longer uses up the allowance everyone shares, so card checkout and booking stay open for real customers. Daily limits hold for the whole day.',
   '2026-10-16', false),
  ('A scheduled job that fails is said', 'fix', 'Crew',
   'The jobs the database runs on its own — re-ringing a critical, releasing a hold, sending pack notices — raise an alert in the inbox when they start failing, instead of failing quietly.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_class where relname = 'push_sent' and relrowsecurity;                                        -- 1
--   select count(*) from pg_trigger where tgname = 'a_live_since' and not tgisinternal;                                  -- 1
--   select has_table_privilege('anon', 'public.push_sent', 'select');                                                   -- false
--   select prosrc like '%h.count < p_max%' from pg_proc where proname = 'rate_limit_hit';                                -- true
--   select prosrc like '%window_start < w%' from pg_proc where proname = 'rate_limit_hit';                               -- true
--   select prosrc like '%push:new-guest%' from pg_proc where proname = 'keep_app_push_token';                            -- true
--   select count(*) from pg_indexes where indexname in ('push_subscriptions_member_idx', 'push_subscriptions_crew_idx', 'push_subscriptions_live_idx'); -- 3
--   select count(*) from cron.job where jobname in ('push-sent-sweep', 'rate-limit-sweep', 'cron-watch');  -- 3
select public.record_migration('0419_a_push_is_sent_once_for_what_happened_and_a_limit_counts_what_it_lets_in');
