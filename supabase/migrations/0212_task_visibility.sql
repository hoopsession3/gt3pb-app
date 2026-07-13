-- 0212 — Task visibility levels, ENFORCED BY RLS (mirrors note visibility, 0170). A delegated to-do
-- now carries who-can-see-it, keyed off our established roles:
--   team       — every staff member can see it (default: a growing team runs on transparency)
--   leadership — only leadership (owner/admin/event_manager) + the assignee
--   private    — only the assignee + leadership
-- event_tasks stay context-scoped (they belong to a visible event/goal/note); this tiers the free-form
-- todos that AssignTaskSheet delegates. Idempotent + additive. Default 'team' matches 0170's call to
-- open shared work to the crew.

alter table public.todos add column if not exists visibility text not null default 'team';
alter table public.todos drop constraint if exists todos_visibility_check;
alter table public.todos add constraint todos_visibility_check check (visibility in ('team','leadership','private'));

-- Existing policies (permissive, OR'd): leadership read (0065) + assignee read own (0210). Add:
-- any staff member may read a 'team'-visible to-do. So leadership sees all; the assignee sees theirs;
-- everyone sees team ones; 'leadership'/'private' stay closed to non-leadership non-assignees.
drop policy if exists "todos team read" on public.todos;
create policy "todos team read" on public.todos for select using ((select public.is_staff()) and visibility = 'team');

-- verify:
--   select count(*) from public.todos where visibility is null;                              -- 0
--   select policyname from pg_policies where tablename='todos' and policyname='todos team read'; -- 1 row
