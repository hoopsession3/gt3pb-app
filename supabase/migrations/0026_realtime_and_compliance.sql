-- 0026 — audit fix (realtime publication) + location-aware compliance for event prep.

-- (AUDIT, HIGH) The event tables were created in 0024/0025 but never added to the
-- supabase_realtime publication, so EventPrep's cross-device sync and EventHUD's live
-- POS/is_live updates silently received nothing. Publish them — this is what makes the
-- "realtime checklist Notion can't do mid-rush" actually true across two phones.
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_tasks;
alter publication supabase_realtime add table public.event_staff;
alter publication supabase_realtime add table public.event_sales;

-- Location → compliance. The event carries its jurisdiction; tasks can carry the
-- official application/reference link so prep is one tap, not a research scramble.
alter table public.events add column if not exists state text;
alter table public.events add column if not exists county text;
alter table public.event_tasks add column if not exists link text;
