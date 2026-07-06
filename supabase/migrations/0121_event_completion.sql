-- 0121 — event completion / after-action. The stage machine (0075: lead→confirmed→prep→live→done)
-- exists, but there was no explicit "wrap" step between Live and Archive — you either pulled the
-- green flag or archived. This adds a first-class completion: stamp WHEN it was done and capture the
-- after-action (what sold, what ran short, one change) — kept for the next event and the due-diligence
-- story, per the Academy AAR. Additive + non-destructive.
alter table public.events add column if not exists completed_at timestamptz;
alter table public.events add column if not exists recap text;

-- when an event is completed via the app (stage→done + completed_at), make sure it's not left "live".
create or replace function public.sync_event_completion() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.stage := 'done';
    new.is_live := false;
  end if;
  return new;
end; $$;
drop trigger if exists events_completion_sync on public.events;
create trigger events_completion_sync before update on public.events for each row execute function public.sync_event_completion();
