-- 0104 — ping the assignee (and leadership inbox) when a task crosses its due date.
-- Mirrors the brew timer (0080): a cron watches open, assigned, dated tasks and raises one alert
-- through the existing alerts spine (→ web push + in-app inbox) the moment due_at passes. An
-- idempotent flag fires it once; editing the due date or reopening the task re-arms it.

alter table public.event_tasks add column if not exists due_alerted boolean not null default false;

-- re-arm the alert if the deadline moves or the task is reopened, so a rescheduled task fires again
create or replace function public.event_tasks_rearm_due() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.due_at is distinct from old.due_at or (old.done and not new.done) then
    new.due_alerted := false;
  end if;
  return new;
end; $$;
drop trigger if exists event_tasks_rearm_due on public.event_tasks;
create trigger event_tasks_rearm_due before update on public.event_tasks
  for each row execute function public.event_tasks_rearm_due();

create or replace function public.task_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select case when t.critical then 'critical' else 'important' end, 'prep',
         '⏰ Task past due — ' || t.label,
         'This task is past its due date' || coalesce(' · ' || e.title, ' · ' || s.name, '') || '. Knock it out or push the date.',
         '/admin', t.assignee, coalesce(e.tenant_id, '00000000-0000-0000-0000-000000000001')
    from public.event_tasks t
    left join public.events e on e.id = t.event_id
    left join public.stops  s on s.id = t.stop_id
   where t.done = false and t.kind = 'task' and t.assignee is not null and t.due_at is not null
     and now() >= t.due_at and not t.due_alerted;

  update public.event_tasks set due_alerted = true
   where done = false and kind = 'task' and assignee is not null and due_at is not null
     and now() >= due_at and not due_alerted;
end; $$;

-- let a user read alerts addressed specifically to them (leadership already reads all); the
-- assignee's push is sent service-side, this just lets their own pings render in-app too.
drop policy if exists "alerts own target read" on public.alerts;
create policy "alerts own target read" on public.alerts for select
  using (target_user_id = auth.uid());

-- watch every 10 minutes (safe re-run; ignore if pg_cron absent)
do $$ begin perform cron.unschedule('task-due-alerts'); exception when others then null; end $$;
do $$ begin perform cron.schedule('task-due-alerts', '*/10 * * * *', 'select public.task_due_alerts()'); exception when others then null; end $$;
