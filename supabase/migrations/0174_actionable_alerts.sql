-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0174 · ACTIONABLE ALERTS — every ping knows WHAT it is about (kind) and WHICH row (subject_id)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- My Day becomes the cockpit: the inbox routes by a machine-readable contract instead of sniffing
-- title strings, and each kind renders an inline handler ON the card (complete the task, start the
-- brew, reply to the booking) — no more teleporting to a section to do a 10-second job.
-- subject_id is polymorphic (the kind names its table) and deliberately NOT an FK: alerts are a
-- log; their subjects are archivable/deletable. Legacy rows (kind null) keep today's routing.
-- The four pg producers below are restated from their latest sources (0164/0145/0123/0162) with
-- kind + subject stamped — body logic byte-identical otherwise.

alter table public.alerts add column if not exists kind text;
alter table public.alerts add column if not exists subject_id uuid;
create index if not exists alerts_kind on public.alerts(kind) where kind is not null;

create or replace function public.task_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select case when t.critical then 'critical' else 'important' end, 'prep', 'task_due', t.id,
         '⏰ Task past due — ' || t.label,
         'This task is past its due date' || coalesce(' · ' || e.title, ' · ' || s.name, ' · goal: ' || g.title, '') || '. Knock it out or push the date.',
         '/crew', t.assignee, coalesce(e.tenant_id, g.tenant_id, '00000000-0000-0000-0000-000000000001')
    from public.event_tasks t
    left join public.events e on e.id = t.event_id
    left join public.stops  s on s.id = t.stop_id
    left join public.goals  g on g.id = t.goal_id
   where t.done = false and t.kind = 'task' and t.assignee is not null and t.due_at is not null
     and now() >= t.due_at and not t.due_alerted;

  update public.event_tasks set due_alerted = true
   where done = false and kind = 'task' and assignee is not null and due_at is not null
     and now() >= due_at and not due_alerted;
end; $$;

create or replace function public.brew_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
declare et constant text := 'America/New_York';
begin
  -- M1 · PLAN — start window opens (heads-up): you can start now, up to latest_start.
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'fyi','brew', 'brew_start_window', b.id, '🫙 Brew window open — '||coalesce(b.recipe_name,'Brew'),
         'Start anytime up to '||to_char(b.latest_start_at at time zone et,'Dy Mon DD, HH12:MI AM')||
           coalesce(' for '||e.title,'')||' ('||coalesce(b.batch_gal::text,'?')||' gal).',
         '/admin', coalesce(b.brewer,b.created_by), b.tenant_id
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
         '/admin', coalesce(b.brewer,b.created_by), 30, b.tenant_id
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
         '/admin', coalesce(b.brewer,b.created_by), b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_started;
  update public.brew_batches set alerted_started=true where status='brewing' and ready_at is not null and not alerted_started;

  -- M5 · BREW — 1 hour to bottle (important).
  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select 'important','brew', 'brew_ready_soon', b.id, '🍶 '||coalesce(b.recipe_name,'Brew')||' ready in ~1 hr',
         coalesce(b.batch_gal::text,'?')||' gal · ready '||to_char(b.ready_at at time zone et,'HH12:MI AM')||'. Prep the station — filter, finish, labels.',
         '/admin', coalesce(b.brewer,b.created_by), b.tenant_id
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
         '/admin', coalesce(b.brewer,b.created_by), 20, b.tenant_id
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
         '/admin', coalesce(b.brewer,b.created_by), b.tenant_id
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
         '/admin', coalesce(b.brewer,b.created_by), b.tenant_id
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

create or replace function public.alert_stale_orders(grace_min int default 10) returns int
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
              '🧾 ' || n || ' order' || case when n = 1 then '' else 's' end || ' waiting on the pass',
              'A ticket has been sitting 10+ minutes in "new" — someone open the kitchen pass.',
              '/admin');
    end if;
  end if;
  return n;
end $$;

create or replace function public.escalate_unacked_criticals() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; own uuid;
begin
  for r in
    select a.id, a.title, a.category, a.link, a.tenant_id, a.kind, a.subject_id
    from public.alerts a
    where a.severity = 'critical' and a.ack_at is null and a.escalated_at is null
      and a.target_user_id is null and a.created_at < now() - interval '30 minutes'
    limit 20
  loop
    select ws.owner_user_id into own from public.work_streams ws
      where ws.tenant_id = r.tenant_id and ws.owner_user_id is not null
        and r.category = any(ws.categories)
      order by ws.sort limit 1;
    if own is not null then
      insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id)
      values ('critical', r.category, r.kind, r.subject_id, left('Unacked 30m — ' || coalesce(r.title, 'critical alert'), 180),
              'Escalated to you as the lane owner.', r.link, own);
      n := n + 1;
    end if;
    update public.alerts set escalated_at = now() where id = r.id;
  end loop;
  return n;
end $$;

-- verify:
--   select count(*) from information_schema.columns where table_name='alerts' and column_name in ('kind','subject_id'); -- 2
--   select prosrc like '%task_due%' from pg_proc where proname='task_due_alerts';                                        -- t
--   select prosrc like '%brew_bottle_now%' from pg_proc where proname='brew_due_alerts';                                 -- t
--   select prosrc like '%order_stale%' from pg_proc where proname='alert_stale_orders';                                  -- t
--   select prosrc like '%r.kind%' from pg_proc where proname='escalate_unacked_criticals';                               -- t
