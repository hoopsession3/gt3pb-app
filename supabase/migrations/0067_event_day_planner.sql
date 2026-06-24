-- 0067 — EVENT DAY PLANNER: a multi-day, time-by-time run-of-show for an event. An event that
-- spans days (e.g. an out-of-town market, day 1–5) gets a planner per day: leave home 9:00, drive,
-- arrive Airbnb (address + gate code), setup, doors, teardown, load out — every logistic captured.
-- events.plan_days holds how many days the planner spans; items hang off the event by day_index.
-- Apply after 0065. Leadership (Ryan/Kayla) read+write; mirrors the todos policy shape.

alter table public.events add column if not exists plan_days int not null default 1;

create table if not exists public.event_schedule_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  event_id    uuid not null references public.events(id) on delete cascade,
  day_index   int not null default 1,            -- 1-based day within the event (Day 1, Day 2, …)
  day_date    date,                              -- optional explicit calendar date for this day
  start_time  text,                              -- free text time so crew can write "9:00a", "noon"
  end_time    text,
  title       text not null,                     -- "Leave home", "Arrive Airbnb", "Doors / service"
  kind        text not null default 'other',     -- travel|lodging|setup|service|meal|meeting|teardown|personal|other
  location    text,                              -- place name ("Airbnb — Peach St", "Duncan Square")
  address     text,                              -- street address for maps / hand-off
  details     text,                              -- everything else: gate code, host, parking, contact #
  who         text,                              -- who's responsible ("Ryan", "Kayla", "Both")
  done        boolean not null default false,
  done_at     timestamptz,
  sort        int not null default 0,            -- tiebreak within the same start_time
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists esi_event on public.event_schedule_items(event_id, day_index);

drop trigger if exists esi_touch on public.event_schedule_items;
create trigger esi_touch before update on public.event_schedule_items for each row execute function public.touch_updated_at();

alter table public.event_schedule_items enable row level security;
-- READ: every crew member on the truck (is_staff = role <> 'member') — the people executing the day
-- must be able to see the run of show. WRITE: leadership only (the planners — Ryan/Kayla/managers).
drop policy if exists "esi staff read"  on public.event_schedule_items;
create policy "esi staff read"  on public.event_schedule_items for select using (public.is_staff());
drop policy if exists "esi leadership write" on public.event_schedule_items;
create policy "esi leadership write" on public.event_schedule_items for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

do $$ begin alter publication supabase_realtime add table public.event_schedule_items; exception when duplicate_object then null; end $$;
