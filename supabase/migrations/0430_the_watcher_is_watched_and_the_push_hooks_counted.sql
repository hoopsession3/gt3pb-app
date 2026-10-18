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
