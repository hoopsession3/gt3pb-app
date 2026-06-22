-- 0037_trailer_profile.sql
-- Single-row trailer + tow-vehicle profile that drives the Load-Out & Tow Plan
-- (load map, tongue-weight + tow-rating checks, tire/tow checklist). Seeded from
-- the GT3 Trailer VIN/cert plate (Diamond Cargo 6x12 SA-2990) + the 2026 Pilot.

create table if not exists public.trailer_profile (
  id              int primary key default 1,
  name            text,
  maker           text,
  size_label      text,
  gvwr_lb         int,
  empty_lb        int,
  cargo_cap_lb    int,
  axle            text,            -- 'single' | 'tandem'
  tire_spec       text,
  tire_psi        int,
  tow_vehicle     text,
  tow_rating_lb   int,
  tongue_limit_lb int,
  vin             text,
  notes           text,
  updated_at      timestamptz default now(),
  constraint trailer_profile_singleton check (id = 1)
);

insert into public.trailer_profile
  (id, name, maker, size_label, gvwr_lb, empty_lb, cargo_cap_lb, axle, tire_spec, tire_psi, tow_vehicle, tow_rating_lb, tongue_limit_lb, vin)
values
  (1, 'GT3 Trailer', 'Diamond Cargo', '6x12 single-axle', 2990, 1300, 1690, 'single',
   'ST205/75R15 C', 50, '2026 Honda Pilot + tow package', 5000, 500, '53NBE1212S1115013')
on conflict (id) do nothing;

alter table public.trailer_profile enable row level security;

drop policy if exists "trailer read" on public.trailer_profile;
create policy "trailer read" on public.trailer_profile for select using (public.is_staff());

drop policy if exists "trailer write" on public.trailer_profile;
create policy "trailer write" on public.trailer_profile for all using (public.is_admin()) with check (public.is_admin());

do $pub$ begin alter publication supabase_realtime add table public.trailer_profile; exception when duplicate_object then null; end $pub$;
