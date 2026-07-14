-- 0218 — Make the 'private' task tier actually private. 0212 added visibility (team / leadership /
-- private) but only a team-read policy; the 0065 leadership policies are permissive (and one is FOR
-- ALL), so 'leadership' and 'private' enforced identically — the UI offered three tiers, the database
-- honored two. A RESTRICTIVE select policy closes it: a private to-do is readable ONLY by its assignee
-- or its creator, no matter what any permissive policy grants. NOTE (deliberate): because UPDATE/DELETE
-- read the row they target, other people's private to-dos are also unmanageable by leadership from the
-- app — private means private; cleanup of a departed teammate's private items is a service-role/SQL
-- job. Workload counts likewise exclude private items you can't see. Idempotent.

drop policy if exists "todos private is private" on public.todos;
create policy "todos private is private" on public.todos as restrictive for select
  using (visibility <> 'private' or assignee = (select auth.uid()) or created_by = (select auth.uid()));

-- verify:
--   select policyname, permissive from pg_policies where tablename = 'todos' order by 1;  -- includes 'todos private is private' RESTRICTIVE
