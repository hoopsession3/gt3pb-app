-- 0093 — DAY-OF CREW BRIEF. Crew assigned to an event/stop need to know how to show up: what to wear
-- (dress code), call time, where to park, what to bring. Leadership sets it; assigned crew read it on
-- their Today and on the event/stop prep. Two free-text fields on both owners (events + stops).

alter table public.events add column if not exists dress_code text;
alter table public.events add column if not exists crew_brief text;
alter table public.stops  add column if not exists dress_code text;
alter table public.stops  add column if not exists crew_brief text;

-- length guards (cheap, keeps a paste from blowing the row up)
alter table public.events drop constraint if exists events_dress_len;
alter table public.events add constraint events_dress_len check (char_length(coalesce(dress_code,'')) <= 600);
alter table public.events drop constraint if exists events_brief_len;
alter table public.events add constraint events_brief_len check (char_length(coalesce(crew_brief,'')) <= 4000);
alter table public.stops  drop constraint if exists stops_dress_len;
alter table public.stops  add constraint stops_dress_len  check (char_length(coalesce(dress_code,'')) <= 600);
alter table public.stops  drop constraint if exists stops_brief_len;
alter table public.stops  add constraint stops_brief_len  check (char_length(coalesce(crew_brief,'')) <= 4000);
