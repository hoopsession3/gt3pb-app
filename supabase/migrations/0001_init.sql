-- GT3PB — Supabase schema (runbook §6 + lightweight auth)
-- Paste this whole file into Supabase → SQL Editor → Run. Idempotent-ish; safe on a fresh project.
-- Auth: email OTP (Supabase Auth). Each signed-in user gets a profile row (their own Today + 3MPIRE).

-- ───────────────────────── profiles (per-user membership) ─────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  referral_code   text unique,
  points          int  not null default 0,
  streak_days     int  not null default 1,
  credit_cents    int  not null default 0,
  founding_member boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Auto-create a profile when a new auth user signs up; derive name + referral code.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
begin
  base := upper(split_part(coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), ' ', 1));
  insert into public.profiles (id, display_name, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', initcap(split_part(new.email,'@',1))),
    left(regexp_replace(base, '[^A-Z0-9]', '', 'g'), 6) || '-3MP'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── daily manual check-in (drives Today) ─────────────────────────
create table if not exists public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null default current_date,
  slept_well  boolean,
  trained     boolean,
  note        text,
  created_at  timestamptz not null default now(),
  unique (user_id, day)
);

-- ───────────────────────── truck: stops + live status ─────────────────────────
create table if not exists public.stops (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location_text text,
  lat           double precision,
  lng           double precision,
  starts_at     timestamptz,
  ends_at       timestamptz,
  status        text not null default 'upcoming' check (status in ('live','upcoming','done')),
  note          text,
  menu_tier     text,
  sort          int not null default 0
);

create table if not exists public.live_status (
  id              int primary key default 1 check (id = 1),  -- single row the truck flips
  current_stop_id uuid references public.stops(id),
  is_live         boolean not null default false,
  next_eta        text
);

-- ───────────────────────── events + RSVPs ─────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  type          text check (type in ('market','drop','club','member')),
  day           date,
  start_time    text,
  end_time      text,
  location_text text,
  member_only   boolean not null default false,
  capacity      int,
  claimed       int default 0,
  going_count   int default 0,
  blurb         text,
  sort          int not null default 0
);

create table if not exists public.rsvps (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.events(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  contact_email text,
  status        text not null default 'going',
  created_at    timestamptz not null default now()
);

-- ───────────────────────── realtime (truck flip is instant) ─────────────────────────
alter publication supabase_realtime add table public.live_status;
alter publication supabase_realtime add table public.stops;

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.profiles    enable row level security;
alter table public.check_ins   enable row level security;
alter table public.stops       enable row level security;
alter table public.live_status enable row level security;
alter table public.events      enable row level security;
alter table public.rsvps       enable row level security;

-- profiles: each user reads/updates only their own
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- check_ins: each user manages only their own
create policy "own checkins read"   on public.check_ins for select using (auth.uid() = user_id);
create policy "own checkins write"  on public.check_ins for insert with check (auth.uid() = user_id);
create policy "own checkins update" on public.check_ins for update using (auth.uid() = user_id);

-- public content: anyone (anon) can read truck + events
create policy "public read stops"  on public.stops       for select using (true);
create policy "public read live"   on public.live_status for select using (true);
create policy "public read events" on public.events      for select using (true);

-- rsvps: anyone can create; signed-in users read their own
create policy "anyone rsvp"       on public.rsvps for insert with check (true);
create policy "own rsvps read"    on public.rsvps for select using (auth.uid() = user_id);

-- ───────────────────────── seed (so live screens aren't empty) ─────────────────────────
insert into public.stops (name, location_text, status, menu_tier, sort) values
  ('Duncan Town Square', 'Saturday Market',     'live',     'full', 0),
  ('Greenville Run Club', 'Hydrate + Rebuild',  'upcoming', 'hydrate-rebuild', 1),
  ('Spartanburg Market',  'Full NET+ bar',      'upcoming', 'full', 2),
  ('Founding First Pour', 'DUSK winter blend · members', 'upcoming', 'member', 3)
on conflict do nothing;

insert into public.live_status (id, current_stop_id, is_live, next_eta)
  select 1, (select id from public.stops where name='Duncan Town Square' limit 1), true, '16:30'
on conflict (id) do nothing;

insert into public.events (title, type, start_time, end_time, location_text, member_only, going_count, blurb, sort) values
  ('Duncan Town Square', 'market', '8', '1',  'Saturday Market',        false, 23, 'Saturday Market', 0),
  ('Founding First Pour', 'member','2:30', null,'DUSK winter blend · tasting', true,  9, 'DUSK winter blend · tasting', 1),
  ('Greenville Run Club', 'club',  '10', '2',  'Hydrate + Rebuild',      false, 11, 'Hydrate + Rebuild', 2)
on conflict do nothing;
