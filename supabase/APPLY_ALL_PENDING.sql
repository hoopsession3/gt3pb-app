-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0430
-- generated-at: 2026-10-18
-- pending-count: 4
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0427_a_slow_answer_is_not_a_failed_one.sql
-- ============================================================
-- ── 0427 — A SLOW ANSWER IS NOT A FAILED ONE, AND A FAILED ONE SAYS WHAT FAILED ───────────────────────────────────────
-- 2026-10-18. R21 of the 10/10 audit (operations F12, the R21 review of 0423; Ryan, 2026-10-17: "Keep working to
-- improve to a 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. 0423 gave cron_watch an alert while requests the database sends fail — the push function's webhook, which carries
-- every alert to the phones, Teams and email. It counted a request the database stopped waiting for as failed. A
-- database webhook waits a second (the dashboard's default) or five (0157's), and the push function can take longer —
-- a cold start, Apple's first connection, a go-live ping to every phone that asked for one — and do all its work after
-- the database has stopped listening. Each such request raised "Requests the database sends are failing", for a push
-- that went. And an answer that did fail said only its status: "HTTP 502", never what failed.
--
-- WHAT. cron_watch, as 0423 wrote it, but for what it reads of pg_net's answers: a 4xx or 5xx answer, or a request that
-- could not be made, is a failure, said at once — with the answer's own words after its status (the push function
-- answers 500 when it lost an event, and 502 naming what it couldn't do when it couldn't write that in the inbox
-- itself — R21, its push_fault line); a timeout (pg_net's flag, or its words for one, as older versions only wrote) is a
-- failure only while nothing in the twenty minutes was answered, two at least — every request timing out is a function
-- that isn't answering, one slow answer among others is not. And the line closes only when an answer came back and none
-- failed: twenty quiet minutes with nothing sent proved nothing, and closing then reopened it at the next failure — one
-- new alert an hour for a fault that never went away (the R21 review). Everything else as 0423 has it, word for word.
--
-- set lock_timeout (database F16): a function only — no table is locked — but the rule is the rule.
-- existing rows: cron_watch — none need restating: its cron_failed and cron_stalled lines are written as 0423 wrote
--   them, and the next run reads pg_net's window as it stands — an open db_http_failed line raised for timeouts alone
--   closes at the first run that finds an answer and nothing failed, and one raised for a real failure is rewritten in
--   the answer's own words by the next run that still finds it.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.cron_watch() returns integer
  language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; bad integer; slow integer; answered integer; last_err text; gap text;
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

  -- A JOB THAT STOPPED (0423). A schedule that no longer fires fails nothing, so the loop above never sees it. A job
  -- that started at least three times this week and has now gone three of its usual gaps (half an hour at least)
  -- without starting is one alert of its own.
  -- Only an active job on an every-day schedule is read for its gaps: one that runs only on some days or some hours (a
  -- Monday's reminder, a service window) has gaps no median says, and a paused one (active = false) is meant to stop.
  for r in
    with runs as (
      select j.jobname, d.start_time,
             extract(epoch from d.start_time - lag(d.start_time) over (partition by d.jobid order by d.start_time))::float8 as gap_s
        from cron.job j join cron.job_run_details d on d.jobid = j.jobid
       where d.start_time > now() - interval '7 days'
         and j.active
         and split_part(j.schedule, ' ', 3) = '*' and split_part(j.schedule, ' ', 4) = '*' and split_part(j.schedule, ' ', 5) = '*'
         -- Every hour: any minute rule. Some hours (every N, or one): once in each of them — '* 3 * * *' runs sixty times
         -- in one hour and then waits twenty-three (R18 review).
         and ((split_part(j.schedule, ' ', 2) = '*' and split_part(j.schedule, ' ', 1) ~ '^(\*|\*/[0-9]+|[0-9]+(,[0-9]+)*)$')
           or (split_part(j.schedule, ' ', 2) ~ '^(\*/[0-9]+|[0-9]+)$' and split_part(j.schedule, ' ', 1) ~ '^[0-9]+$'))
    )
    -- Its usual gap is the long end of its gaps (the ninetieth percentile, R18 review): a minute list like '0,10,20'
    -- waits forty minutes every hour, and a median of ten would call each of those a stop.
    select jobname, max(start_time) as last_start, percentile_cont(0.9) within group (order by gap_s) as usual_s
      from runs group by jobname
    having count(*) >= 3
  loop
    continue when r.usual_s is null or now() - r.last_start <= make_interval(secs => greatest(3 * r.usual_s, 1800));
    gap := case when r.usual_s < 5400 then round((r.usual_s / 60)::numeric) || case when round((r.usual_s / 60)::numeric) = 1 then ' minute' else ' minutes' end
                when r.usual_s < 172800 then round((r.usual_s / 3600)::numeric) || case when round((r.usual_s / 3600)::numeric) = 1 then ' hour' else ' hours' end
                else round((r.usual_s / 86400)::numeric) || case when round((r.usual_s / 86400)::numeric) = 1 then ' day' else ' days' end end;
    perform public.alert_open_once('cron_stalled', md5('cron-stalled:' || r.jobname)::uuid, 'important', 'system',
      'A scheduled job stopped running — ' || r.jobname,
      'It usually starts about every ' || gap || '; it last started '
        || to_char(r.last_start at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  end loop;
  -- A job that started again since its line was raised closes it: the mechanism's ack (ack_by left null, 0340's way).
  update public.alerts a set ack_at = now()
   where a.kind = 'cron_stalled' and a.ack_at is null
     and exists (select 1 from cron.job j join cron.job_run_details d on d.jobid = j.jobid
                  where md5('cron-stalled:' || j.jobname)::uuid = a.subject_id and d.start_time > a.created_at);

  -- WHAT THE DATABASE SENT AND DIDN'T LAND (0423; 0427: a slow answer is not a failed one). pg_net keeps six hours of
  -- answers to the requests the database makes — the push function's webhook among them, which carries every alert to
  -- the phones, Teams and email. An answer of 4xx or 5xx, or a request that could not be made at all, is a failure, said
  -- at once and in the answer's own words (the push function says its own faults in the inbox — R21, push_fault — and
  -- answers 502 naming them only when it couldn't). A request the database stopped waiting for (a webhook waits a
  -- second, or five) may have done all its work after, so a timeout is said only while nothing in the window was
  -- answered at all, two at least: every request timing out is a function that isn't answering; one slow cold start
  -- among answers is not.
  begin
    execute $q$
      with a as (
        select status_code, content, error_msg, created,
               coalesce(timed_out, false) or error_msg ilike 'timeout%' or error_msg ilike '%timed out%' as slow
          from net._http_response
         where created > now() - interval '20 minutes')
      select count(*) filter (where status_code >= 400 or (not slow and nullif(btrim(error_msg), '') is not null))::int,
             count(*) filter (where slow)::int,
             count(*) filter (where status_code between 100 and 399)::int,
             (array_agg(left(case when status_code >= 400
                                  then 'HTTP ' || status_code::text || coalesce(' — ' || nullif(btrim(content), ''), '')
                                  else btrim(error_msg) end, 200) order by created desc)
                filter (where status_code >= 400 or (not slow and nullif(btrim(error_msg), '') is not null)))[1]
        from a$q$
      into bad, slow, answered, last_err;
  exception when others then
    -- No pg_net here, or its answers can't be read: nothing to say about them either way — an open line stays open
    -- (unread is not answering again) — and never the reason the failed-job and stopped-job lines above go unwritten
    -- (one error here rolled the whole run back).
    bad := null;
  end;
  if bad = 0 and slow >= 2 and answered = 0 then
    bad := slow;
    last_err := 'nothing it sent was answered before the database stopped waiting';
  end if;
  if bad > 0 then
    perform public.alert_open_once('db_http_failed', md5('db-http:sent')::uuid, 'important', 'system',
      'Requests the database sends are failing — ' || bad || ' in 20 minutes',
      'Most likely the push function''s webhook: alerts may not be reaching phones, Teams or email until it answers. The last said: '
        || coalesce(last_err, '(nothing)') || '.',
      '/crew?s=settings&a=set-errors');
    n := n + 1;
  elsif bad = 0 and answered > 0 then
    -- Answering again — an answer back and none failed: the line closes itself, as the stopped job's does.
    update public.alerts set ack_at = now()
     where kind = 'db_http_failed' and subject_id = md5('db-http:sent')::uuid and ack_at is null;
  end if;

  -- The run log keeps a week (it grew by thousands of rows a day and was never pruned).
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return n;
end $$;
revoke all on function public.cron_watch() from public, anon, authenticated;
comment on function public.cron_watch() is
  'Every ten minutes (0419, 0423, 0427): a job with failed runs in the last twenty minutes (cron_failed), an active every-day job that has gone three of its usual gaps without starting (cron_stalled, closed when it starts again) — one open alert per job — and one alert while requests the database sent failed in the last twenty minutes — an answer of 4xx/5xx or a request not made, in the answer''s own words; timeouts only while nothing was answered (db_http_failed, 0427; closed when one is answered and none fails). The run log keeps a week.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A slow answer is not a failure', 'fix', 'System',
   'The alert that says requests from the database are failing now names what the push service couldn''t do — Teams, an email, Apple — and no longer fires for an answer that was only slow.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_proc where proname = 'cron_watch' and prosrc like '%answered = 0%';                       -- 1
--   select has_function_privilege('authenticated', 'public.cron_watch()', 'execute');                            -- f
select public.record_migration('0427_a_slow_answer_is_not_a_failed_one');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go.sql
-- ============================================================
-- ── 0428 — THE STUDIO'S ROOM IS ITS EDITORS', AND A PHONE NOBODY KEEPS IS LET GO ─────────────────────────────────────
-- 2026-10-18. R22 of the 10/10 audit (security F12, database F14; Ryan, 2026-10-17: "Keep working to improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. (1) The Studio's co-editing (components/Studio) talks on a Realtime channel named for the piece — who is in it,
-- and each field as it is typed — and the channel was public: anyone holding the app's public key and a piece's id could
-- join, see the crew's names, and type into an open editor's fields. (2) Every phone and browser the app keeps for
-- alerts is a row in push_subscriptions, and one nobody is signed in on, and that asked to hear nothing, was kept for
-- ever: a device that stopped opening the app left its row, and a script registering devices left all of its.
--
-- WHAT. (1) Who may join the Studio's room for a piece, hear it and speak in it: whoever can read the piece — its
-- business's leadership (content_items' own rules, asked as the caller). The room is private now (Realtime
-- Authorization: policies on realtime.messages, and the page asks for a private channel); a public channel of the same
-- name is another room, and hears nothing of this one. (2) A device is "seen" whenever the app keeps it again — every
-- launch of the iPhone app, every browser that asks — and one nobody is signed in on, that asked for no news, and that
-- has not been seen for thirty days is let go each morning. A member's device, and one that asked to hear when the truck
-- goes live, are never let go for quiet; a gone one is still deleted the moment Apple or a push service says so.
--
-- set lock_timeout (database F16): one column added to push_subscriptions (no rewrite — its default is set once), two
-- functions, two policies, a schedule.
-- existing rows: every device kept today is seen as of this paste — thirty days' grace for each.
-- changelog: below.

set lock_timeout = '5s';

-- ── (1) the Studio's room ─────────────────────────────────────────────────────────────────────────────────────────
-- A topic is the room's name as the page gives it: 'studio-' and the piece's id. Anything else is no room of the
-- Studio's (the uuid is checked before it is cast, so a malformed name is a closed door, not an error).
drop policy if exists "studio: the piece's editors hear its room" on realtime.messages;
create policy "studio: the piece's editors hear its room" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and exists (select 1 from public.content_items c
                      where c.id = (select case when realtime.topic() ~ '^studio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                then substr(realtime.topic(), 8)::uuid end)));
drop policy if exists "studio: the piece's editors speak in its room" on realtime.messages;
create policy "studio: the piece's editors speak in its room" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and exists (select 1 from public.content_items c
                           where c.id = (select case when realtime.topic() ~ '^studio-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                     then substr(realtime.topic(), 8)::uuid end)));

-- ── (2) a device is seen when it is kept, and one nobody keeps is let go ──────────────────────────────────────────
alter table public.push_subscriptions add column if not exists seen_at timestamptz not null default now();
comment on column public.push_subscriptions.seen_at is
  'When the app last kept this device (0428: keep_push_device, keep_app_push_token — every launch of the iPhone app). One nobody is signed in on, that asked for no news (wants_live) and unseen for 30 days is let go each morning (push-device-sweep).';

-- As 0418 and 0419 wrote them, with the stamp (the R22 test holds every other line to theirs).
create or replace function public.keep_push_device(p_endpoint text, p_p256dh text, p_auth text,
  p_crew boolean default null, p_wants_live boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if coalesce(length(p_endpoint), 0) not between 12 and 2048 or p_endpoint !~ '^https://' then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  -- 0418: at a browser's push service — any other address was a post the push function made to wherever it said.
  if not public.push_host_ok(p_endpoint) then
    raise exception 'That isn''t a push subscription.' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 16 and 256 or coalesce(length(p_auth), 0) not between 8 and 128 then
    raise exception 'That push subscription has no keys.' using errcode = '22023';
  end if;
  -- 0418: a new device nobody is signed in on is counted — three hundred an hour, for everyone together. A member's is
  -- not: theirs replaces their other browsers (below), so it cannot pile up.
  if v_user is null and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint)
     and not public.rate_limit_hit('push:new-guest', 3600000, 300) then
    raise exception 'Too many devices just now — try again in a while.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions as s (endpoint, p256dh, auth, user_id, is_admin, wants_live, seen_at)
  values (p_endpoint, p_p256dh, p_auth, v_user, coalesce(p_crew, false), coalesce(p_wants_live, false), now())
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,          -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = case when s.user_id is distinct from excluded.user_id then coalesce(p_crew, false)
                    else coalesce(p_crew, false) or s.is_admin end,
    wants_live = coalesce(p_wants_live, s.wants_live),
    seen_at = now();                         -- 0428: kept again is seen again (a device nobody keeps is let go)
  -- One browser each: the person's other browsers go (a reinstall or a new browser mints a new endpoint, and every
  -- alert fanned out to all the stale ones). Only browsers — an endpoint that is a web address.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> p_endpoint and endpoint like 'https://%';
  end if;
end $$;
revoke all on function public.keep_push_device(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.keep_push_device(text, text, text, boolean, boolean) to anon, authenticated;

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
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin, seen_at)
  values (v_endpoint, 'apns', null, null, v_user, true, now())          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true,
    seen_at = now();                                            -- 0428: kept again is seen again
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public, anon, authenticated;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

-- The sweep, each morning (0419's sweeps are at :17 and :23 past seven). A member's device is theirs until they sign
-- out or it is gone; one that asked to hear when the truck goes live stays while it lives.
do $$ begin perform cron.unschedule('push-device-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('push-device-sweep', '29 7 * * *',
    $q$delete from public.push_subscriptions where user_id is null and not wants_live and seen_at < now() - interval '30 days'$q$);
exception when others then
  raise notice '0428: pg_cron is not here — the sweep is: delete from public.push_subscriptions where user_id is null and not wants_live and seen_at < now() - interval ''30 days''';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Studio talks only to its editors', 'security', 'Studio',
   'Co-editing a piece in the Studio — who is in it, and the fields as they are typed — goes over a private room only the piece''s editors can join. It was a public channel anyone with the piece''s id could listen to and type into.',
   '2026-10-18', false),
  ('Devices nobody uses are let go', 'fix', 'Alerts',
   'A phone or browser kept for alerts that nobody is signed in on, that asked for no news, and that hasn''t opened the app in thirty days is let go each morning. Members'' devices, and ones waiting to hear the truck is live, are kept.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'studio:%';  -- 2
--   select count(*) from information_schema.columns where table_name = 'push_subscriptions' and column_name = 'seen_at';     -- 1
--   select prosrc like '%seen_at = now()%' from pg_proc where proname in ('keep_push_device', 'keep_app_push_token');        -- t, t
--   select count(*) from cron.job where jobname = 'push-device-sweep';                                                     -- 1
select public.record_migration('0428_the_studio_room_is_its_editors_and_a_phone_nobody_keeps_is_let_go');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0429_a_text_is_sent_once_for_what_happened.sql
-- ============================================================
-- ── 0429 — A TEXT IS SENT ONCE FOR WHAT HAPPENED ───────────────────────────────────────────────────────────────────
-- 2026-10-18. R22 of the 10/10 audit (API F11; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A message to a customer named nothing of what it was about: the Pass pressed twice told the member twice that
-- their order was ready; a stop called off whose first call died part way never told its packs, because a second call
-- couldn't know who had heard; a provider's webhook told again sent its shipping notice again.
--
-- WHAT. The app names what happened — "order-ready:<order>", "stop-canceled:<stop>:pack:<pack>" (lib/notify onceKey) —
-- and the same name twice is one message. An email is held to it by Resend (its Idempotency-Key, kept a day). A text is
-- held to it here: public.message_sent keeps each text's key — claimed just before the text goes, marked sent when it
-- went, let go again if it didn't, and taken over by the next call when a claim was never marked in two minutes (the
-- call that claimed it died on the way: a text missed is worse than one doubled). The service role's alone, ninety days
-- — push_sent's shape (0419), for the push function's own.
--
-- set lock_timeout (database F16): one new table — nothing else is touched.
-- existing rows: none — a new table.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.message_sent (
  event_key  text primary key check (char_length(event_key) between 3 and 220),
  claimed_at timestamptz not null default now(),   -- the text about to go (lib/notify claimText)
  sent_at    timestamptz                            -- when the provider took it; null while it is going, or if the call died
);
alter table public.message_sent enable row level security;   -- no policy: the app's server (service role) alone
revoke all on public.message_sent from public, anon, authenticated;
grant select, insert, update, delete on public.message_sent to service_role;
create index if not exists message_sent_claimed_idx on public.message_sent (claimed_at);
comment on table public.message_sent is
  'One row per text the app sent for something that happened (0429): its key names it (text:order-ready:<id>, text:stop-canceled:<stop>:pack:<id>, …) — claimed just before the text goes, marked sent when it went, let go if it did not, and taken over by the next call when never marked within two minutes; so the same thing told twice is texted once. Emails are held to the same keys by Resend. Kept ninety days.';

do $$ begin perform cron.unschedule('message-sent-sweep'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('message-sent-sweep', '19 7 * * *', $q$delete from public.message_sent where claimed_at < now() - interval '90 days'$q$);
exception when others then
  raise notice '0429: pg_cron is not here — the sweep is: delete from public.message_sent where claimed_at < now() - interval ''90 days''';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A message is sent once', 'fix', 'Ordering',
   'Telling a customer something names what it is about — this order ready, this stop called off for this pack — and the same thing told twice is one email and one text: a button pressed twice, or a call retried after it stopped part way, no longer tells them twice, and a retry now reaches whoever the first try missed.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_class where relname = 'message_sent' and relrowsecurity;                                     -- 1
--   select has_table_privilege('anon', 'public.message_sent', 'select');                                                -- false
--   select count(*) from cron.job where jobname = 'message-sent-sweep';                                                 -- 1
select public.record_migration('0429_a_text_is_sent_once_for_what_happened');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor

-- ============================================================
-- 0430_the_watcher_is_watched_and_the_push_hooks_counted.sql
-- ============================================================
-- ── 0430 — THE WATCHER IS WATCHED, AND THE PUSH WEBHOOKS ARE COUNTED ─────────────────────────────────────────────────
-- 2026-10-18. R24 of the 10/10 audit (database F8 and F6, operations F11 and F19; Ryan, 2026-10-17: "Keep working to
-- improve to a 10").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. pg_cron runs every scheduled job the migrations made — the watchdogs, the reminders, the sweeps — and cron_watch
-- (0419, 0423, 0427) says a job that fails or stops. But cron_watch is one of those jobs: if pg_cron stopped, or
-- cron_watch itself failed every run, nothing in the database was left to say so, and the alerts it would have raised
-- were simply never raised. And a job that was never made in this database (a restore, a project moved, a migration
-- pasted half) or that someone unscheduled fails nothing and stops nothing — it isn't there to be read. The push
-- webhooks are the same kind of thing: ten of the triggers that carry an order, a booking, a sign-up or an alert to the
-- phones, Teams and email were made in the dashboard (database F6), in no migration — one deleted or switched off there
-- is a push that silently never goes, and nothing looked.
--
-- WHAT. One question the app's own server may ask, from outside the database: public.ops_alive(p_jobs, p_from, p_hooks)
-- answers when cron_watch last finished without failing, how many active jobs there are, how many of the jobs the app
-- knows the migrations made (lib/opsWatch CRON_JOBS — held to the migrations by scripts/r24.test.mjs) are missing or
-- switched off — each counted only once the migration that made it is in this database's ledger, so a migration not yet
-- pasted is not "missing" — and how many of the push webhooks the app names (lib/opsWatch PUSH_HOOKS — held to the
-- security snapshot) are not on their table or are switched off. /api/health asks it and says whether the scheduled
-- jobs run and the webhooks are on; the half-hourly production check (scripts/verify.prod.mjs) fails when they are not —
-- outside the database, so a stopped pg_cron is heard. Counts and a time only: no job's or trigger's name, command or
-- address leaves the database (a webhook's definition carries its address and key — never read here).
--
-- set lock_timeout (database F16): a function only — nothing is locked — but the rule is the rule.
-- existing rows: none — a new function; cron_watch and the webhooks are not touched.
-- changelog: below.

set lock_timeout = '5s';

create or replace function public.ops_alive(p_jobs text[], p_from text[], p_hooks text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- when the watcher last finished without failing: a stopped pg_cron, and a watcher failing every run, both age it
    'watched_at', (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'cron-watch' and d.status = 'succeeded'),
    'active', (select count(*) from cron.job j where j.active),
    -- each job the app names, once the migration that made it is applied here (the ledger, 0304): not there, or off
    'missing', (select count(*) from unnest(coalesce(p_jobs, '{}'::text[]), coalesce(p_from, '{}'::text[])) as x(job, made_by)
                 where exists (select 1 from public.schema_migrations m where m.version = x.made_by)
                   and not exists (select 1 from cron.job j where j.jobname = x.job and j.active)),
    -- each push webhook the app names ("table.trigger", public's): not on that table, or switched off (tgenabled D) —
    -- its name and switch only, never its definition (it carries the function's address and key)
    'hooks_off', (select count(*) from unnest(coalesce(p_hooks, '{}'::text[])) as h(hook)
                   where not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                                      where n.nspname = 'public' and c.relname = split_part(h.hook, '.', 1) and t.tgname = split_part(h.hook, '.', 2)
                                        and not t.tgisinternal and t.tgenabled <> 'D')));
$$;
revoke all on function public.ops_alive(text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.ops_alive(text[], text[], text[]) to service_role;
comment on function public.ops_alive(text[], text[], text[]) is
  'Whether the scheduled jobs run and the push webhooks are on (0430): when cron_watch last finished without failing, how many jobs are active, how many of the jobs the app names (lib/opsWatch CRON_JOBS, with the migration that made each) are missing or switched off — counted only once that migration is in the ledger — and how many of the push webhooks it names (PUSH_HOOKS) are not there or are off. The app''s server alone (/api/health); counts and a time, never a name, a command or a definition.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The watcher is watched', 'fix', 'System',
   'The jobs the database runs on a schedule — the watchdogs, reminders and sweeps — and the hooks that carry orders and alerts to phones are checked from outside it every half hour: if the scheduler stopped, its watcher failed, a job went missing or a push hook was switched off, the production check fails and says so.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.ops_alive(text[], text[], text[])', 'execute');                  -- false
--   select has_function_privilege('service_role', 'public.ops_alive(text[], text[], text[])', 'execute');          -- true
--   select (public.ops_alive('{}', '{}', '{}') ->> 'active')::int > 0;                                              -- true
select public.record_migration('0430_the_watcher_is_watched_and_the_push_hooks_counted');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
