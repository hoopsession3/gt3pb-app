-- 0075 — EVENT LIFECYCLE: every event carries a stage so you always know where it stands and what's
-- next — Lead → Confirmed → Prep → Live → Done. Live/Done auto-sync with the green flag and the
-- archive; the planning stages you set. From the meeting notes: "the entire event lifecycle, intake
-- to completion." Apply after 0074.

alter table public.events add column if not exists stage text not null default 'confirmed'
  check (stage in ('lead','confirmed','prep','live','done'));

-- backfill existing rows so nothing looks half-set
update public.events set stage = 'live' where is_live = true;
update public.events set stage = 'done' where archived_at is not null and is_live is not true;

-- Keep stage honest as the green flag / archive move (so it never drifts from reality).
create or replace function public.sync_event_stage() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.is_live and not coalesce(old.is_live, false) then
    new.stage := 'live';                                  -- green flag out
  elsif (new.is_live is not true) and coalesce(old.is_live, false) then
    new.stage := 'done';                                  -- green flag pulled → it's wrapped
  end if;
  if new.archived_at is not null and old.archived_at is null then
    new.stage := 'done';                                  -- archived → done
  end if;
  return new;
end; $$;
drop trigger if exists events_stage_sync on public.events;
create trigger events_stage_sync before update on public.events for each row execute function public.sync_event_stage();
