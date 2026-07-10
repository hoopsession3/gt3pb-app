-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0164 · GOAL MOVES RIDE THE TASK ENGINE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Same precedent as 0049 (meeting-note follow-ups): a goal's initiatives become event_tasks rows
-- owned by goal_id, so they get owners, due dates, My Tasks, assignment pushes, the task-due
-- ladder, and calendar presence for free — one task spine, not two. goal_initiatives (0163,
-- hours old) folds in and goes away.

alter table public.event_tasks add column if not exists goal_id uuid references public.goals(id) on delete cascade;
alter table public.event_tasks drop constraint if exists event_tasks_one_owner;
alter table public.event_tasks add constraint event_tasks_one_owner
  check (((event_id is not null)::int + (stop_id is not null)::int + (meeting_note_id is not null)::int + (goal_id is not null)::int) = 1);
create index if not exists event_tasks_goal on public.event_tasks(goal_id);

-- The verify pass caught an RLS regression: event_tasks writes are is_admin()-only (0025), but
-- the Goals board is worked by LEADERSHIP incl. event managers (0142's contract, kept by 0163).
-- Goal-owned rows get a leadership write policy — permissive policies OR with the admin ones,
-- and everything else on event_tasks stays exactly as it was.
drop policy if exists "event_tasks goal moves leadership" on public.event_tasks;
create policy "event_tasks goal moves leadership" on public.event_tasks
  for all using (
    goal_id is not null and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  ) with check (
    goal_id is not null and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  );

-- The due-date ladder (0104) fires for goal moves already (no event_id dependence), but its ping
-- knew only events/stops and linked to /admin. Now it names the goal and links to /crew.
create or replace function public.task_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
  select case when t.critical then 'critical' else 'important' end, 'prep',
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

-- fold + retire, re-runnably (the 0038 re-open-approval trigger keys on event_id — null here,
-- harmless no-op; a second run of this script skips the fold because the table is gone)
do $$ begin
  if to_regclass('public.goal_initiatives') is not null then
    insert into public.event_tasks (goal_id, label, kind, done, sort)
      select goal_id, title, 'task', done, sort from public.goal_initiatives;
    drop table public.goal_initiatives;
  end if;
end $$;

-- verify:
--   select count(*) from public.event_tasks where goal_id is not null;            -- = old initiative count
--   select to_regclass('public.goal_initiatives');                                 -- null
--   select count(*) from pg_policies where tablename = 'event_tasks' and policyname like '%goal moves%';  -- 1
