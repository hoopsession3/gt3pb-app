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
