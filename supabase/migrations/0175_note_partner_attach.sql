-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0175 · NOTES ATTACH TO A PARTNER — a note can hang off a vendor (partner), not just event/stop/opp
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The notes spine already links to event_id, stop_id, opportunity_id (0167/0170). A note taken on a
-- PARTNER call (a gym, a café, a wholesale account's parent vendor) had nowhere to hang. Add the
-- vendor link so "attach to anything we operate from" is complete: event · truck · opportunity ·
-- partner. Nullable, on delete set null (a note outlives an archived vendor). Legacy rows unaffected.

alter table public.meeting_notes add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
create index if not exists meeting_notes_vendor on public.meeting_notes(vendor_id) where vendor_id is not null;

-- verify:
--   select count(*) from information_schema.columns where table_name='meeting_notes' and column_name='vendor_id'; -- 1
