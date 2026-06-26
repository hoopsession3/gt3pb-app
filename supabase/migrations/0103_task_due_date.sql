-- 0103 — per-task due date. Until now "past due" was inferred from the owning event/stop's date;
-- a real due_at lets an operator put a deadline on any single task (e.g. "order bottles by Thu")
-- independent of when the event runs. Nullable: tasks without a due date fall back to owner-date.
alter table public.event_tasks add column if not exists due_at timestamptz;

-- the "tasks past due" glance counts open task-kind rows with due_at in the past; index for it.
create index if not exists event_tasks_due_open
  on public.event_tasks (due_at)
  where done = false and kind = 'task' and due_at is not null;
