-- 0210 — One task spine + close the delegation hole. Work is split across two tables — event_tasks
-- (the rich per-event/goal/note engine) and todos (free-form, from AssignTaskSheet). The accountability
-- bug: todos were leadership-read-only (0065), but "My Tasks"/My Day reads event_tasks, so a task you
-- DELEGATE via AssignTaskSheet ("it's in their day now") never reached the assignee — invisible to any
-- crew member. As the team grows 2→5 that's the exact failure that drops the ball.
-- Fix: (1) an assignee can see + complete their OWN todo; (2) an all_tasks read model unions both tables
-- (the "one task spine" the audit called for — as a view, so nothing is ripped out). Idempotent + additive.

-- (1) An assignee sees and can complete their own todo (adds to the leadership policy — permissive OR).
drop policy if exists "todos assignee read" on public.todos;
create policy "todos assignee read" on public.todos for select using (assignee = auth.uid());
drop policy if exists "todos assignee update" on public.todos;
create policy "todos assignee update" on public.todos for update using (assignee = auth.uid()) with check (assignee = auth.uid());

-- (2) The unified read model — one place to see any task, whichever table it lives in. security_invoker
-- so each caller sees exactly what their RLS allows (crew: their own todos + staff event_tasks).
create or replace view public.all_tasks with (security_invoker = on) as
  select 'event'::text as source, id, label as title, assignee, due_at::date as due,
         done, done_at, created_at, critical, section as category, event_id, goal_id, meeting_note_id
  from public.event_tasks
  union all
  select 'todo', id, title, assignee, due_on as due,
         done, done_at, created_at, false as critical, category, event_id, null::uuid, meeting_note_id
  from public.todos;
grant select on public.all_tasks to authenticated;

-- verify:
--   select policyname from pg_policies where tablename='todos' and policyname like 'todos assignee%';  -- 2 rows
--   select source, count(*) from public.all_tasks group by 1;                                          -- event + todo
