-- 0192 — Move an event/stop date → the brew back-schedule follows (audit P0·1, the #1 staleness risk)
-- The brew commit copies needed_by / brew_date / ready_at from the event day ONCE, at creation
-- (app/api/agents/brew/route.ts). Nothing re-derived them, so moving an event's date left every linked
-- batch's "start-by" alarm, ready time, and overdue flag pointed at the OLD date — silently wrong.
-- Now a trigger recomputes the schedule for still-'planned' batches whenever the source date moves. The
-- 0084 trigger then recomputes latest_start_at from the new needed_by, so the alert ladder self-heals.
--
-- The three schedule fields are reproduced EXACTLY as the route computes them (8:00 America/New_York
-- anchor; brew_date is the UTC calendar date of start; ready_at is 8am ET on brew_date + extraction).
-- Only 'planned' batches are touched — a batch already brewing or done keeps its real timestamps.

-- 8:00 AM America/New_York on a given day → the "needed by" instant.
create or replace function public.brew_needed_by(p_day date) returns timestamptz
  language sql immutable as $$ select (p_day + time '08:00') at time zone 'America/New_York'; $$;

-- The brew START calendar date: needed_by minus ceil(extraction) hours, taken as the UTC date
-- (matches the route's server-local date extraction on Vercel/UTC).
create or replace function public.brew_start_date(p_day date, p_ext numeric) returns date
  language sql immutable as $$
    select ((public.brew_needed_by(p_day) - (ceil(coalesce(p_ext, 0)) * interval '1 hour')) at time zone 'UTC')::date;
  $$;

-- Ready = 8am ET on the brew start date + the extraction window.
create or replace function public.brew_ready_at(p_day date, p_ext numeric) returns timestamptz
  language sql immutable as $$
    select ((public.brew_start_date(p_day, p_ext) + time '08:00') at time zone 'America/New_York')
         + (coalesce(p_ext, 0) * interval '1 hour');
  $$;

-- Re-derive every still-planned batch linked to this event (direct FK or via brew_batch_links).
create or replace function public.resync_event_brews() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.day is not null and new.day is distinct from old.day then
    update public.brew_batches b set
      needed_by = public.brew_needed_by(new.day),
      brew_date = public.brew_start_date(new.day, b.extraction_hours),
      ready_at  = public.brew_ready_at(new.day, b.extraction_hours)
    where b.status = 'planned'
      and (b.event_id = new.id
           or b.id in (select batch_id from public.brew_batch_links where event_id = new.id));
  end if;
  return new;
end $$;

create or replace function public.resync_stop_brews() returns trigger
  language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if new.starts_at is not null and new.starts_at is distinct from old.starts_at then
    d := (new.starts_at at time zone 'UTC')::date;
    update public.brew_batches b set
      needed_by = public.brew_needed_by(d),
      brew_date = public.brew_start_date(d, b.extraction_hours),
      ready_at  = public.brew_ready_at(d, b.extraction_hours)
    where b.status = 'planned'
      and (b.stop_id = new.id
           or b.id in (select batch_id from public.brew_batch_links where stop_id = new.id));
  end if;
  return new;
end $$;

drop trigger if exists resync_event_brews_tg on public.events;
create trigger resync_event_brews_tg after update of day on public.events
  for each row execute function public.resync_event_brews();

drop trigger if exists resync_stop_brews_tg on public.stops;
create trigger resync_stop_brews_tg after update of starts_at on public.stops
  for each row execute function public.resync_stop_brews();

-- verify: expect both triggers present.
-- select tgname from pg_trigger where tgname in ('resync_event_brews_tg','resync_stop_brews_tg');
