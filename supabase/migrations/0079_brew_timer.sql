-- 0079 — live brew timer + on-brand brew alerts.
-- Hit "Start brew" on a batch: brew_started_at is stamped and ready_at = start + extraction_hours
-- (20h house standard). A countdown shows in-app. A cron watches brewing batches and raises alerts
-- through the existing alerts spine (→ Teams + web push): a 1-hour heads-up, then "time to bottle"
-- when it's ready. Idempotent flags so each alert fires once.

alter table public.brew_batches add column if not exists brew_started_at  timestamptz;
alter table public.brew_batches add column if not exists extraction_hours numeric not null default 20;
alter table public.brew_batches add column if not exists alerted_soon     boolean not null default false;
alter table public.brew_batches add column if not exists alerted_ready    boolean not null default false;

create or replace function public.brew_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- 1-hour heads-up
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'important', 'brew',
         '🍺 ' || coalesce(b.recipe_name, 'Brew') || ' almost ready — 1 hr',
         coalesce(b.batch_gal::text, '?') || ' gal · ready ~' || to_char(b.ready_at, 'HH12:MI AM'),
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status = 'brewing' and b.ready_at is not null
     and now() >= b.ready_at - interval '1 hour' and now() < b.ready_at
     and not b.alerted_soon;
  update public.brew_batches set alerted_soon = true
   where status = 'brewing' and ready_at is not null
     and now() >= ready_at - interval '1 hour' and now() < ready_at and not alerted_soon;

  -- ready → time to bottle (and flip status to 'ready')
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select 'critical', 'brew',
         '🍺 Time to bottle — ' || coalesce(b.recipe_name, 'Brew'),
         coalesce(b.batch_gal::text, '?') || ' gal · ' || coalesce(b.target_spec, 'to spec') || '. Filter clean, add the finish, bottle/keg + refrigerate. Log the Signal Score.',
         '/admin', b.created_by, b.tenant_id
    from public.brew_batches b
   where b.status = 'brewing' and b.ready_at is not null
     and now() >= b.ready_at and not b.alerted_ready;
  update public.brew_batches set alerted_ready = true, status = 'ready'
   where status = 'brewing' and ready_at is not null
     and now() >= ready_at and not alerted_ready;
end; $$;

-- Schedule the watcher every 10 minutes (safe re-run: unschedule then schedule; ignore if pg_cron absent).
do $$ begin perform cron.unschedule('brew-due-alerts'); exception when others then null; end $$;
do $$ begin perform cron.schedule('brew-due-alerts', '*/10 * * * *', 'select public.brew_due_alerts()'); exception when others then null; end $$;
