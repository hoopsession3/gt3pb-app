-- 0080 — performance indexes + close the push_subscriptions INSERT gap.
-- Verified findings (a 0009 fix already closed the UPDATE hole; these remain):
--  • The company calendar range-scans events.day and stops.starts_at on every load; My Tasks scans
--    event_tasks by assignee. No indexes existed — add them (invisible now, real as data grows).
--  • push_subscriptions INSERT was WITH CHECK (true) → a subscription could be attributed to another
--    user_id. Scope it the same way 0009 scoped UPDATE (anon rows or the owner).

create index if not exists events_day_idx          on public.events(day)          where archived_at is null;
create index if not exists stops_starts_at_idx      on public.stops(starts_at)      where archived_at is null;
create index if not exists event_tasks_assignee_idx on public.event_tasks(assignee) where done = false;

drop policy if exists "sub insert" on public.push_subscriptions;
create policy "sub insert" on public.push_subscriptions for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
