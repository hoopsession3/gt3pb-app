-- 0036_event_tasks_dedupe_warn.sql
-- The pack list double-inserted (no idempotency guard) so every item showed twice.
-- Dedupe existing rows, block recurrence with a unique index, and add the `warn`
-- tier (amber) so the checklist isn't an all-red wall.

alter table public.event_tasks add column if not exists warn boolean not null default false;

-- delete duplicate rows, keeping the earliest physical row per (event_id, section, label)
delete from public.event_tasks a
using public.event_tasks b
where a.event_id = b.event_id
  and coalesce(a.section, '') = coalesce(b.section, '')
  and a.label = b.label
  and a.ctid > b.ctid;

-- prevent future duplicates outright
create unique index if not exists event_tasks_unique_item
  on public.event_tasks (event_id, (coalesce(section, '')), label);
