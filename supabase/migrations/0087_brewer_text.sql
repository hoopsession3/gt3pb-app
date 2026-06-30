-- 0087 — reconcile brewer to TEXT (the production-log brewer NAME), not a user FK.
-- 0084 added brew_batches.brewer as uuid (for alert targeting); 0086 + the deployed app treat it as a
-- free-text name (StartBrewSheet / the production-log editor write "Ryan"). A uuid column rejects a
-- name, so the brew-log brewer field is broken. The app's meaning wins: make brewer text. brew_batches
-- is empty, so dropping + re-adding the column is clean. First recreate brew_due_alerts() without the
-- brewer uuid (it was never populatable by the app anyway) — target created_by only. Apply after 0086.

create or replace function public.brew_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
declare et constant text := 'America/New_York';
begin
  -- M1 · PLAN — start window opens (heads-up): you can start now, up to latest_start.
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'fyi','brew', '🫙 Brew window open — '||coalesce(b.recipe_name,'Brew'),
         'Start anytime up to '||to_char(b.latest_start_at at time zone et,'Dy Mon DD, HH12:MI AM')||
           coalesce(' for '||e.title,'')||' ('||coalesce(b.batch_gal::text,'?')||' gal).',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and b.latest_start_at is not null and not b.alerted_start_window
     and now() >= b.latest_start_at - interval '4 hours' and now() < b.latest_start_at;
  update public.brew_batches set alerted_start_window=true
   where status='planned' and latest_start_at is not null and not alerted_start_window
     and now() >= latest_start_at - interval '4 hours' and now() < latest_start_at;

  -- M2 · PLAN — START BY now (critical, ack-or-escalate after 30 min).
  insert into public.alerts (severity, category, title, body, link, target_user_id, escalate_after_min, tenant_id)
  select 'critical','brew', '⏰ Start '||coalesce(b.recipe_name,'the brew')||' now',
         coalesce(b.batch_gal::text,'?')||' gal · '||coalesce(ceil(b.extraction_hours)::text,'20')||'h extraction — start now to be ready by '||
           to_char(b.needed_by at time zone et,'Dy Mon DD, HH12:MI AM')||coalesce(' for '||e.title,'')||'.',
         '/admin', b.created_by, 30, b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and b.latest_start_at is not null and not b.alerted_start_by and now() >= b.latest_start_at;
  update public.brew_batches set alerted_start_by=true
   where status='planned' and latest_start_at is not null and not alerted_start_by and now() >= latest_start_at;

  -- M3 · PLAN — AT RISK (critical, broadcast): 2h past latest start, still not brewing.
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', '🚨 '||coalesce(b.recipe_name,'Brew')||' at risk'||coalesce(' — '||e.title,''),
         'Past its latest start and not brewing — it won''t be ready in time. Start now or cut the batch size.',
         '/admin', null, b.tenant_id
    from public.brew_batches b left join public.events e on e.id=b.event_id
   where b.status='planned' and b.latest_start_at is not null and not b.alerted_at_risk
     and now() >= b.latest_start_at + interval '2 hours';
  update public.brew_batches set alerted_at_risk=true
   where status='planned' and latest_start_at is not null and not alerted_at_risk
     and now() >= latest_start_at + interval '2 hours';

  -- M4 · BREW — brewing started (heads-up confirmation).
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'fyi','brew', '✅ '||coalesce(b.recipe_name,'Brew')||' brewing',
         coalesce(b.batch_gal::text,'?')||' gal · ready ~'||to_char(b.ready_at at time zone et,'Dy Mon DD, HH12:MI AM')||'. I''ll ping 1 hr out.',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_started;
  update public.brew_batches set alerted_started=true where status='brewing' and ready_at is not null and not alerted_started;

  -- M5 · BREW — 1 hour to bottle (important).
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'important','brew', '🍶 '||coalesce(b.recipe_name,'Brew')||' ready in ~1 hr',
         coalesce(b.batch_gal::text,'?')||' gal · ready '||to_char(b.ready_at at time zone et,'HH12:MI AM')||'. Prep the station — filter, finish, labels.',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_soon
     and now() >= b.ready_at - interval '1 hour' and now() < b.ready_at;
  update public.brew_batches set alerted_soon=true
   where status='brewing' and ready_at is not null and not alerted_soon
     and now() >= ready_at - interval '1 hour' and now() < ready_at;

  -- M6 · BREW — READY, bottle now (critical, ack-or-escalate after 20 min) + flip status to 'ready'.
  insert into public.alerts (severity, category, title, body, link, target_user_id, escalate_after_min, tenant_id)
  select 'critical','brew', '🍺 Time to bottle — '||coalesce(b.recipe_name,'Brew'),
         coalesce(b.batch_gal::text,'?')||' gal · '||coalesce(b.target_spec,'to spec')||'. Filter clean, add the finish, bottle/keg + refrigerate. Log the Signal Score.',
         '/admin', b.created_by, 20, b.tenant_id
    from public.brew_batches b
   where b.status='brewing' and b.ready_at is not null and not b.alerted_ready and now() >= b.ready_at;
  update public.brew_batches set alerted_ready=true, status='ready'
   where status='brewing' and ready_at is not null and not alerted_ready and now() >= ready_at;

  -- M7 · BREW — over-extracting (critical, broadcast): ready 45 min ago, still not bottled.
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', '⚠️ Pull '||coalesce(b.recipe_name,'the brew')||' now',
         'Hit ready '||to_char(b.ready_at at time zone et,'HH12:MI AM')||' and isn''t bottled — it''s drifting off spec. Filter + keg/bottle now.',
         '/admin', null, b.tenant_id
    from public.brew_batches b
   where b.status in ('brewing','ready') and b.ready_at is not null and not b.alerted_overextract
     and now() >= b.ready_at + interval '45 minutes';
  update public.brew_batches set alerted_overextract=true
   where status in ('brewing','ready') and ready_at is not null and not alerted_overextract
     and now() >= ready_at + interval '45 minutes';

  -- M8 · HOLD — hold window closing (important): 8h before the hold ends.
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'important','brew', 'Hold window closing — '||coalesce(b.recipe_name,'Brew'),
         'Ends '||to_char((b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int))) at time zone et,'Dy HH12:MI AM')||'. Serve today or plan to dump.',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status in ('ready','kegged') and b.ready_at is not null and not b.alerted_hold_soon
     and now() >= b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int)) - interval '8 hours'
     and now() <  b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int));
  update public.brew_batches set alerted_hold_soon=true
   where status in ('ready','kegged') and ready_at is not null and not alerted_hold_soon
     and now() >= ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int)) - interval '8 hours'
     and now() <  ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int));

  -- M9 · HOLD — expired (critical).
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', 'Past hold — '||coalesce(b.recipe_name,'Brew'),
         'Past the '||coalesce(ceil(b.hold_hours)::text,'72')||'h hold window. Quality-check before serving; likely dump.',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status in ('ready','kegged') and b.ready_at is not null and not b.alerted_hold_expired
     and now() >= b.ready_at + make_interval(hours => greatest(1,ceil(b.hold_hours)::int));
  update public.brew_batches set alerted_hold_expired=true
   where status in ('ready','kegged') and ready_at is not null and not alerted_hold_expired
     and now() >= ready_at + make_interval(hours => greatest(1,ceil(hold_hours)::int));

  -- ESCALATE — any critical brew alert left unacked past its window: re-ping the whole crew, once.
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'critical','brew', '🔁 Still open — '||a.title, coalesce(a.body,'')||' (no one''s on it yet)',
         a.link, null, a.tenant_id
    from public.alerts a
   where a.category='brew' and a.severity='critical' and a.ack_at is null and a.escalated_at is null
     and a.escalate_after_min is not null and now() >= a.created_at + make_interval(mins => a.escalate_after_min);
  update public.alerts set escalated_at=now()
   where category='brew' and severity='critical' and ack_at is null and escalated_at is null
     and escalate_after_min is not null and now() >= created_at + make_interval(mins => escalate_after_min);
end; $$;

-- now the column has no dependency on the uuid type — convert it to a plain text name.
alter table public.brew_batches drop column if exists brewer;
alter table public.brew_batches add column if not exists brewer text;
