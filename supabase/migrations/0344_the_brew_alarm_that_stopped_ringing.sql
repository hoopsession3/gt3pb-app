-- ── THE BREW ALARM THAT STOPPED RINGING ──────────────────────────────────────────────────────
-- 2026-10-04. Found by the form audit (Ryan: "auto fill where applicable … if relational database,
-- generate pick list"), tracing where the Start-brew sheet's typed "Brewer" goes.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- brew_due_alerts() is the whole brew alarm ladder — start window, START BY NOW, at risk, brewing,
-- ready in an hour, TIME TO BOTTLE, over-extracting, hold closing, past hold, and the re-ping when a
-- critical goes unanswered. pg_cron runs it every five minutes (0084).
--
-- 0084 added brew_batches.brewer as a uuid so the alarms could find the brewer. 0087 found that the
-- app writes a NAME there ("Ryan"), retyped the column to text, and restated the function to target
-- created_by alone — "the brewer uuid was never populatable by the app anyway". Then 0145 replaced
-- the function again to add a sibling guard — restated from 0084's text, not 0087's — and brought
-- back `coalesce(b.brewer, b.created_by)`: a text and a uuid. 0174 carried it forward when it
-- added kind and subject_id. Postgres cannot reconcile the two —
--
--     ERROR:  COALESCE types text and uuid cannot be matched
--
-- — and plpgsql only checks a statement when it first runs it, so both migrations applied cleanly
-- and the function has failed on every run since 0145. One error rolls back the whole call: none of
-- the ten rungs has fired. (Reproduced on Postgres: scripts/db.brewalarm.test.mjs runs 0174's
-- function, which fails, and this one, which rings.)
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. brew_batches.brewer_id — WHO brewed it, as a person: the Start-brew sheet picks them from the
--    crew (defaulting to whoever is signed in) and keeps writing the name to `brewer` for the log.
-- 2. brew_due_alerts() restated verbatim from 0174 with one change, seven times: the alarm goes to
--    coalesce(b.brewer_id, b.created_by) — both uuids — the brewer when one is named, else whoever
--    planned it. /api/agents/brew now records who planned it (it never set created_by), so a batch
--    nobody has started yet reaches its planner rather than everyone.
-- 3. The moments that passed while it was broken stay passed (below), so reviving it does not ring
--    months of brewing at once.

-- ── 1 · WHO BREWED IT, AS A PERSON ─────────────────────────────────────────────────────────────
alter table public.brew_batches add column if not exists brewer_id uuid references auth.users(id) on delete set null;
comment on column public.brew_batches.brewer_id is
  'Who brewed it (the Start-brew sheet, from the crew). The brew alarms go to them, else to created_by. `brewer` keeps the name for the production log.';

-- ── 2 · WHAT HAPPENED WHILE IT WAS SILENT STAYS IN THE PAST ────────────────────────────────────
-- existing rows: brew_due_alerts — it has not completed a run since 0174, so no alerted_* flag has
-- been set since and every moment that passed would fire at the first run after this one: a "start
-- now", an "at risk", a "time to bottle" and an "over-extracting" for every batch left planned or
-- brewing, re-pinged to the whole crew 20 minutes later. A moment more than twelve hours gone is
-- history, not an alarm; its flag is set here, and the batch's status is left exactly as it is
-- (one still "brewing" from August is the brew board's to close, not this migration's to guess).
-- Moments still ahead, or inside the last twelve hours, are untouched and ring as designed.
update public.brew_batches set alerted_start_by = true
 where status = 'planned' and not alerted_start_by and latest_start_at < now() - interval '12 hours';
update public.brew_batches set alerted_at_risk = true
 where status = 'planned' and not alerted_at_risk and latest_start_at + interval '2 hours' < now() - interval '12 hours';
update public.brew_batches set alerted_started = true
 where status = 'brewing' and not alerted_started and ready_at is not null and coalesce(brew_started_at, ready_at) < now() - interval '12 hours';
update public.brew_batches set alerted_ready = true
 where status = 'brewing' and not alerted_ready and ready_at < now() - interval '12 hours';
update public.brew_batches set alerted_overextract = true
 where status in ('brewing','ready') and not alerted_overextract and ready_at + interval '45 minutes' < now() - interval '12 hours';
update public.brew_batches set alerted_hold_soon = true
 where status in ('ready','kegged') and not alerted_hold_soon and ready_at is not null
   and ready_at + make_interval(hours => greatest(1, ceil(hold_hours)::int)) < now() - interval '12 hours';
update public.brew_batches set alerted_hold_expired = true
 where status in ('ready','kegged') and not alerted_hold_expired and ready_at is not null
   and ready_at + make_interval(hours => greatest(1, ceil(hold_hours)::int)) < now() - interval '12 hours';
-- …and a brew critical from before 0174 that nobody answered is not re-pinged now as "still open".
update public.alerts set escalated_at = now()
 where category = 'brew' and severity = 'critical' and ack_at is null and escalated_at is null
   and escalate_after_min is not null and created_at < now() - interval '12 hours';

-- ── 3 · THE LADDER, RESTATED FROM 0174 — the alarm finds a person ──────────────────────────────
create or replace function public.brew_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
declare et constant text := 'America/New_York';
begin
  -- M1 · PLAN — start window opens (heads-up): you can start now, up to latest_start.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'fyi','brew', 'brew_start_window', b.id, '🫙 Brew window open — '||coalesce(b.recipe_name,'Brew'),
         'Start anytime up to '||to_char(b.latest_start_at at time zone et,'Dy Mon DD, HH12:MI AM')||
           coalesce(' for '||e.title,'')||' ('||coalesce(b.batch_gal::text,'?')||' gal).',
         '/admin', coalesce(b.brewer_id, b.created_by), b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and not exists (select 1 from public.brew_batches s where s.id <> b.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(b.recipe_name,'') and s.event_id is not distinct from b.event_id and s.stop_id is not distinct from b.stop_id and s.needed_by is not distinct from b.needed_by) and b.latest_start_at is not null and not b.alerted_start_window
     and now() >= b.latest_start_at - interval '4 hours' and now() < b.latest_start_at;
  update public.brew_batches set alerted_start_window=true
   where status='planned' and not exists (select 1 from public.brew_batches s where s.id <> brew_batches.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(brew_batches.recipe_name,'') and s.event_id is not distinct from brew_batches.event_id and s.stop_id is not distinct from brew_batches.stop_id and s.needed_by is not distinct from brew_batches.needed_by) and latest_start_at is not null and not alerted_start_window
     and now() >= latest_start_at - interval '4 hours' and now() < latest_start_at;

  -- M2 · PLAN — START BY now (critical, ack-or-escalate after 30 min).
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, escalate_after_min, tenant_id)
  select 'critical','brew', 'brew_start_now', b.id, '⏰ Start '||coalesce(b.recipe_name,'the brew')||' now',
         coalesce(b.batch_gal::text,'?')||' gal · '||coalesce(ceil(b.extraction_hours)::text,'20')||'h extraction — start now to be ready by '||
           to_char(b.needed_by at time zone et,'Dy Mon DD, HH12:MI AM')||coalesce(' for '||e.title,'')||'.',
         '/admin', coalesce(b.brewer_id, b.created_by), 30, b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and not exists (select 1 from public.brew_batches s where s.id <> b.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(b.recipe_name,'') and s.event_id is not distinct from b.event_id and s.stop_id is not distinct from b.stop_id and s.needed_by is not distinct from b.needed_by) and b.latest_start_at is not null and not b.alerted_start_by and now() >= b.latest_start_at;
  update public.brew_batches set alerted_start_by=true
   where status='planned' and not exists (select 1 from public.brew_batches s where s.id <> brew_batches.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(brew_batches.recipe_name,'') and s.event_id is not distinct from brew_batches.event_id and s.stop_id is not distinct from brew_batches.stop_id and s.needed_by is not distinct from brew_batches.needed_by) and latest_start_at is not null and not alerted_start_by and now() >= latest_start_at;

  -- M3 · PLAN — AT RISK (critical, broadcast): 2h past latest start, still not brewing.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', 'brew_at_risk', b.id, '🚨 '||coalesce(b.recipe_name,'Brew')||' at risk'||coalesce(' — '||e.title,''),
         'Past its latest start and not brewing — it won''t be ready in time. Start now or cut the batch size.',
         '/admin', null, b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and not exists (select 1 from public.brew_batches s where s.id <> b.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(b.recipe_name,'') and s.event_id is not distinct from b.event_id and s.stop_id is not distinct from b.stop_id and s.needed_by is not distinct from b.needed_by) and b.latest_start_at is not null and not b.alerted_at_risk
     and now() >= b.latest_start_at + interval '2 hours';
  update public.brew_batches set alerted_at_risk=true
   where status='planned' and not exists (select 1 from public.brew_batches s where s.id <> brew_batches.id and s.status = 'brewing' and coalesce(s.recipe_name,'') = coalesce(brew_batches.recipe_name,'') and s.event_id is not distinct from brew_batches.event_id and s.stop_id is not distinct from brew_batches.stop_id and s.needed_by is not distinct from brew_batches.needed_by) and latest_start_at is not null and not alerted_at_risk
     and now() >= latest_start_at + interval '2 hours';

  -- M4 · BREW — brewing started (heads-up confirmation).
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'fyi','brew', 'brew_started', b.id, '✅ '||coalesce(b.recipe_name,'Brew')||' brewing',
         coalesce(b.batch_gal::text,'?')||' gal · ready ~'||to_char(b.ready_at at time zone et,'Dy Mon DD, HH12:MI AM')||'. I''ll ping 1 hr out.',
         '/admin', coalesce(b.brewer_id, b.created_by), b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_started;
  update public.brew_batches set alerted_started=true where status='brewing' and ready_at is not null and not alerted_started;

  -- M5 · BREW — 1 hour to bottle (important).
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'important','brew', 'brew_ready_soon', b.id, '🍶 '||coalesce(b.recipe_name,'Brew')||' ready in ~1 hr',
         coalesce(b.batch_gal::text,'?')||' gal · ready '||to_char(b.ready_at at time zone et,'HH12:MI AM')||'. Prep the station — filter, finish, labels.',
         '/admin', coalesce(b.brewer_id, b.created_by), b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_soon
     and now() >= b.ready_at - interval '1 hour' and now() < b.ready_at;
  update public.brew_batches set alerted_soon=true
   where status='brewing' and ready_at is not null and not alerted_soon
     and now() >= ready_at - interval '1 hour' and now() < ready_at;

  -- M6 · BREW — READY, bottle now (critical, ack-or-escalate after 20 min) + flip status to 'ready'.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, escalate_after_min, tenant_id)
  select 'critical','brew', 'brew_bottle_now', b.id, '🍺 Time to bottle — '||coalesce(b.recipe_name,'Brew'),
         coalesce(b.batch_gal::text,'?')||' gal · '||coalesce(b.target_spec,'to spec')||'. Filter clean, add the finish, bottle/keg + refrigerate. Log the Signal Score.',
         '/admin', coalesce(b.brewer_id, b.created_by), 20, b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_ready and now() >= b.ready_at;
  update public.brew_batches set alerted_ready=true, status='ready'
   where status='brewing' and ready_at is not null and not alerted_ready and now() >= ready_at;

  -- M7 · BREW — over-extracting (critical, broadcast): ready 45 min ago, still not bottled.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', 'brew_overextract', b.id, '⚠️ Pull '||coalesce(b.recipe_name,'the brew')||' now',
         'Hit ready '||to_char(b.ready_at at time zone et,'HH12:MI AM')||' and isn''t bottled — it''s drifting off spec. Filter + keg/bottle now.',
         '/admin', null, b.tenant_id
    from public.brew_batches b
   where b.status in ('brewing','ready') and b.ready_at is not null and not b.alerted_overextract
     and now() >= b.ready_at + interval '45 minutes';
  update public.brew_batches set alerted_overextract=true
   where status in ('brewing','ready') and ready_at is not null and not alerted_overextract
     and now() >= ready_at + interval '45 minutes';

  -- M8 · HOLD — hold window closing (important): 8h before the hold ends.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'important','brew', 'brew_hold_closing', b.id, 'Hold window closing — '||coalesce(b.recipe_name,'Brew'),
         'Ends '||to_char((b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int))) at time zone et,'Dy HH12:MI AM')||'. Serve today or plan to dump.',
         '/admin', coalesce(b.brewer_id, b.created_by), b.tenant_id
    from public.brew_batches b
   where b.status in ('ready','kegged') and b.ready_at is not null and not b.alerted_hold_soon
     and now() >= b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int)) - interval '8 hours'
     and now() <  b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int));
  update public.brew_batches set alerted_hold_soon=true
   where status in ('ready','kegged') and ready_at is not null and not alerted_hold_soon
     and now() >= ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int)) - interval '8 hours'
     and now() <  ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int));

  -- M9 · HOLD — expired (critical).
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', 'brew_hold_expired', b.id, 'Past hold — '||coalesce(b.recipe_name,'Brew'),
         'Past the '||coalesce(ceil(b.hold_hours)::text,'72')||'h hold window. Quality-check before serving; likely dump.',
         '/admin', coalesce(b.brewer_id, b.created_by), b.tenant_id
    from public.brew_batches b
   where b.status in ('ready','kegged') and b.ready_at is not null and not b.alerted_hold_expired
     and now() >= b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int));
  update public.brew_batches set alerted_hold_expired=true
   where status in ('ready','kegged') and ready_at is not null and not alerted_hold_expired
     and now() >= ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int));

  -- ESCALATE — any critical brew alert left unacked past its window: re-ping the whole crew, once.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', a.kind, a.subject_id, '🔁 Still open — '||a.title, coalesce(a.body,'')||' (no one''s on it yet)',
         a.link, null, a.tenant_id
    from public.alerts a
   where a.category='brew' and a.severity='critical' and a.ack_at is null and a.escalated_at is null
     and a.escalate_after_min is not null and now() >= a.created_at + make_interval(mins => a.escalate_after_min);
  update public.alerts set escalated_at=now()
   where category='brew' and severity='critical' and ack_at is null and escalated_at is null
     and escalate_after_min is not null and now() >= created_at + make_interval(mins => escalate_after_min);
end; $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The brew alarms ring again, for the person brewing','fix','Brew',
   'The brew alarms — start window, start now, at risk, brewing, ready in an hour, time to bottle, over-extracting, hold closing, past hold — had stopped firing: a change in the summer mixed the brewer''s name with a user id, and the database refused every run without saying so. They run again, and they go to the person brewing, who is now picked from the crew on the Start brew sheet (you, unless you say otherwise), or else to whoever planned the batch. Moments that passed while they were silent were left in the past rather than rung all at once.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0344_the_brew_alarm_that_stopped_ringing',
  'brew_batches.brewer_id uuid (auth.users, set null). brew_due_alerts restated verbatim from 0174 with coalesce(b.brewer, b.created_by) -> coalesce(b.brewer_id, b.created_by) in all seven targets: 0087 made brewer text, 0145 restated 0084''s uuid-era text (0174 carried it), and COALESCE(text, uuid) failed every pg_cron run since 0145. Existing rows: alerted_* set for moments more than 12 hours past (start_by, at_risk, started, ready, overextract, hold_soon, hold_expired), statuses untouched; unanswered brew criticals older than 12 hours marked escalated so they are not re-pinged. /api/agents/brew stamps created_by.');

-- verify:
--   select public.brew_due_alerts();   -- returns, rather than "COALESCE types text and uuid cannot be matched"
--   select column_name, data_type from information_schema.columns where table_name = 'brew_batches' and column_name = 'brewer_id';   -- uuid
--   select count(*) from public.alerts where category = 'brew' and created_at > now() - interval '10 minutes';   -- only batches whose moments are current
