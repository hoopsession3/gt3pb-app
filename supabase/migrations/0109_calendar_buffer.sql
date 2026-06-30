-- 0109 — a default "leave/setup buffer" (minutes) per event and truck stop, so the Add-to-calendar
-- button pre-fills the travel+setup time the crew should block before service. Owner-settable in the
-- prep hub; the "when do we leave?" agent can also auto-fill it from the drive estimate.
alter table public.events add column if not exists default_buffer_min int;
alter table public.stops  add column if not exists default_buffer_min int;
