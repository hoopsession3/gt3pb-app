-- 0032_event_archive.sql
-- Let operators file completed events out of their active workspace without
-- losing the record (kept for AAR / due-diligence). Archiving also closes the
-- event (the app clears is_live), so nothing stays "live" after it's done.
alter table public.events add column if not exists archived_at timestamptz;

-- fast lookup of the active (non-archived) set the operator actually works
create index if not exists events_active_idx on public.events (archived_at) where archived_at is null;
