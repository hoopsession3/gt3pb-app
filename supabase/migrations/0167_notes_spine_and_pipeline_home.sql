-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0167 · NOTES SPINE + PIPELINE'S RIGHT HOME + DEAL AUDIT STAMP
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Pipeline moves to the BUSINESS lane (owner call, and it's the standard model: a sales
--    funnel is the commercial function, not event ops). Events lane returns to plan+prep.
-- 2. Notes become systematic: a meeting note can link to an EVENT or a TRUCK STOP (stop_id joins
--    event_id), and every task a note generates carries origin_note_id — a pure attribution
--    column, NOT part of the one-owner XOR — so a follow-up can live on the event/stop prep
--    checklist AND still trace back to the meeting that spawned it.
-- 3. deals.updated_at — the catalog is managed, so edits carry a stamp.

update public.work_streams set sections = '{plan,prep}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'events' and sections = '{plan,pipeline,prep}';
update public.work_streams set sections = '{money,customers,pipeline,team,goals,notes}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'business' and sections = '{money,customers,team,goals,notes}';

alter table public.meeting_notes add column if not exists stop_id uuid references public.stops(id) on delete set null;
create index if not exists meeting_notes_stop on public.meeting_notes(stop_id);

alter table public.event_tasks add column if not exists origin_note_id uuid references public.meeting_notes(id) on delete set null;
create index if not exists event_tasks_origin_note on public.event_tasks(origin_note_id);

alter table public.deals add column if not exists updated_at timestamptz not null default now();

-- verify:
--   select key, array_to_string(sections, ',') from public.work_streams where key in ('events','business');
--   select count(*) from information_schema.columns where table_name = 'meeting_notes' and column_name = 'stop_id';    -- 1
--   select count(*) from information_schema.columns where table_name = 'event_tasks' and column_name = 'origin_note_id'; -- 1
