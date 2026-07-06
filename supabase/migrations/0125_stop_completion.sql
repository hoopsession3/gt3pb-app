-- 0125 — stop completion, mirroring event completion (0121). A truck stop that's over needs the
-- same explicit wrap step an event has: stamp WHEN it was done, capture the after-action, and file
-- it off the active lists. Additive + non-destructive.
alter table public.stops add column if not exists completed_at timestamptz;
alter table public.stops add column if not exists recap text;

-- On the completion transition: force status to 'done', and — the operationally important bit —
-- if the stop being completed is the CURRENT live stop, take the truck offline so guests never
-- see a "live" location that's actually wrapped.
create or replace function public.sync_stop_completion() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.status := 'done';
    update public.live_status set is_live = false, current_stop_id = null
     where id = 1 and current_stop_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists stops_completion_sync on public.stops;
create trigger stops_completion_sync before update on public.stops for each row execute function public.sync_stop_completion();
