-- 0172 — BOOKINGS ↔ PIPELINE BRIDGE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The July 2026 redundancy audit named Plan › Bookings (inbound requests) and Business › Pipeline
-- (outbound pursuit) two parallel lead funnels that should BRIDGE, not merge. This is the bridge's
-- one schema fact: a promoted booking request remembers its opportunity — so the button can't
-- double-promote, and the request card can point straight at the pursuit.

alter table public.booking_requests
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
create index if not exists booking_requests_opportunity_idx
  on public.booking_requests(opportunity_id) where opportunity_id is not null;

-- Make the comments record honest while we're in here: 0140 gave comments a strategy subject and
-- every surface since (playbook, goals, the pipeline pursuit trail) inserts strategy-only rows,
-- but the 0051 constraint on file still reads "exactly one of task/note/alert". Re-state it so a
-- strategy_key alone is a valid subject — a no-op wherever prod already allows it.
alter table public.comments drop constraint if exists comments_one_subject;
alter table public.comments add constraint comments_one_subject check (
  ((event_task_id is not null)::int + (meeting_note_id is not null)::int + (alert_id is not null)::int) = 1
  or (strategy_key is not null
      and event_task_id is null and meeting_note_id is null and alert_id is null)
);

-- verify:
--   select count(*) from information_schema.columns
--     where table_name='booking_requests' and column_name='opportunity_id';                    -- 1
--   select count(*) from pg_constraint where conname='comments_one_subject';                   -- 1
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname='comments_one_subject';                                                    -- mentions strategy_key
