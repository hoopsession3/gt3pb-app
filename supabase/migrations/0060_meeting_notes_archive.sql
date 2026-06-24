-- 0060 — archive meeting notes (keep them, hide from the active list). Apply after 0049. Idempotent.
alter table public.meeting_notes add column if not exists archived_at timestamptz;
create index if not exists meeting_notes_active on public.meeting_notes(met_on desc) where archived_at is null;
