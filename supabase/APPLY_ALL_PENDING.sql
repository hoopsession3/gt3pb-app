-- GT3PB  apply all pending migrations + role fix, in order. Idempotent (safe to re-run).
-- Paste this whole file into the Supabase SQL editor and Run.


-- ============================================================
-- 0028_event_economics.sql
-- ============================================================
-- 0028_event_economics.sql
-- Event ROI / P&L layer. Revenue is already tracked (event_sales + orders);
-- this adds the COST side + projection knobs so the owner can answer
-- "is this event worth doing?" before committing, and reconcile after.
--
-- SECURITY: costs/margins are owner-sensitive and the public.events row is
-- world-readable (guests browse events). So economics live in SEPARATE
-- admin-only tables  cost data never rides on the public event row.

--  per-event projection knobs + cost lines (admin-only) 
create table if not exists public.event_economics (
  event_id          uuid primary key references public.events(id) on delete cascade,
  capture_pct       numeric not null default 0.35,   -- share of attendance that buys
  items_per_guest   numeric not null default 1.2,    -- units per buying guest
  cogs_pct          numeric not null default 0.30,   -- blended COGS fallback when a line is un-costed
  labor_rate_cents  int     not null default 1800,   -- $/hr per crew member
  booth_cents       int     not null default 0,      -- vendor / space fee
  transport_cents   int     not null default 0,      -- fuel / getting the rig there
  permit_cents      int     not null default 0,      -- temp permit / insurance
  consumables_cents int     not null default 0,      -- cups / lids / ice / CO2
  updated_at        timestamptz not null default now()
);

alter table public.event_economics enable row level security;
-- admin/owner only (servers must NOT see margins)
drop policy if exists "evecon admin all" on public.event_economics;
create policy "evecon admin all" on public.event_economics
  for all using (is_admin()) with check (is_admin());

--  product economics catalog: representative price + unit cost per menu
--    line (admin-edited, "layered" model). null unit cost  blended fallback.
create table if not exists public.product_economics (
  product_key      text primary key,   -- nitro | nature_aid | salted_maple | bottles | broth
  label            text not null,
  price_cents      int  not null default 0,
  unit_cost_cents  int,                 -- null = fall back to event cogs_pct
  active           boolean not null default true,
  sort             int not null default 0,
  updated_at       timestamptz not null default now()
);

alter table public.product_economics enable row level security;
drop policy if exists "prodecon admin all" on public.product_economics;
create policy "prodecon admin all" on public.product_economics
  for all using (is_admin()) with check (is_admin());

-- representative seed (price + ~30% cost)  owner tunes to real numbers.
insert into public.product_economics (product_key, label, price_cents, unit_cost_cents, sort) values
  ('nitro',        'Nitro cold brew', 700, 210, 1),
  ('nature_aid',   'Nature Aid',      800, 250, 2),
  ('salted_maple', 'Salted Maple',    750, 235, 3),
  ('bottles',      'Bottles',        1200, 430, 4),
  ('broth',        'Broth',           900, 300, 5)
on conflict (product_key) do nothing;

-- keep updated_at honest
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_evecon_touch on public.event_economics;
create trigger trg_evecon_touch before update on public.event_economics
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_prodecon_touch on public.product_economics;
create trigger trg_prodecon_touch before update on public.product_economics
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 0030_academy.sql
-- ============================================================
-- 0030_academy.sql
-- GT3 Academy: per-user training progress + certifications.
-- Content (modules, products, cookbook, quizzes) is authored in code
-- (lib/academy.ts) and keyed by slug; this table stores who has done what,
-- their scores, and which certifications they've earned. Role-based paths and
-- operational-readiness are derived from these rows.

--  per-module progress (one row per user per module) 
create table if not exists public.academy_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  module_slug  text not null,
  status       text not null default 'in_progress' check (status in ('in_progress','complete')),
  score        int,                 -- last quiz score %, null if module has no quiz
  best_score   int,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, module_slug)
);
alter table public.academy_progress enable row level security;
-- each person owns their progress; admins/owners read all for the team dashboard
drop policy if exists "own progress" on public.academy_progress;
create policy "own progress" on public.academy_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read progress" on public.academy_progress;
create policy "staff read progress" on public.academy_progress
  for select using (is_admin());

--  earned certifications (one row per user per cert) 
create table if not exists public.academy_certifications (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cert_key    text not null,
  awarded_at  timestamptz not null default now(),
  expires_at  timestamptz,          -- null = no expiry; set for time-boxed certs
  primary key (user_id, cert_key)
);
alter table public.academy_certifications enable row level security;
drop policy if exists "own certs" on public.academy_certifications;
create policy "own certs" on public.academy_certifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read certs" on public.academy_certifications;
create policy "staff read certs" on public.academy_certifications
  for select using (is_admin());

-- realtime so the admin team-readiness board updates as people learn
do $pub$ begin alter publication supabase_realtime add table public.academy_progress; exception when duplicate_object then null; end $pub$;
do $pub$ begin alter publication supabase_realtime add table public.academy_certifications; exception when duplicate_object then null; end $pub$;

-- ============================================================
-- 0031_academy_governance.sql
-- ============================================================
-- 0031_academy_governance.sql
-- Academy governance: real expanded roles, training assignments with due dates,
-- and food-safety e-sign acknowledgements. Builds on 0030 (academy core) and
-- 0023 (roles / is_admin / is_owner / is_staff).

--  1) expanded account roles 
-- Make event managers, operators and contractors real account roles so their
-- Academy learning paths light up (was: member/server/admin/owner only).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member','server','operator','event_manager','contractor','admin','owner'));

-- any non-member is staff (Academy + service access); admin/owner unchanged
create or replace function public.is_staff() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role <> 'member');
$$;

-- owner-only role setter, expanded value set
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;
  update public.profiles set role = new_role where id = member;
end; $$;

--  2) training assignments (admin assigns work + a due date) 
create table if not exists public.academy_assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('module','cert','path')),
  target_key  text not null,
  due_at      timestamptz,
  assigned_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.academy_assignments enable row level security;
drop policy if exists "assignee read" on public.academy_assignments;
create policy "assignee read" on public.academy_assignments
  for select using (auth.uid() = user_id or is_admin());
drop policy if exists "admin assign" on public.academy_assignments;
create policy "admin assign" on public.academy_assignments
  for all using (is_admin()) with check (is_admin());

--  3) signed acknowledgements (food-safety e-sign, etc.) 
create table if not exists public.academy_acknowledgements (
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc_key     text not null,
  signed_name text not null,
  signed_at   timestamptz not null default now(),
  primary key (user_id, doc_key)
);
alter table public.academy_acknowledgements enable row level security;
drop policy if exists "own acks" on public.academy_acknowledgements;
create policy "own acks" on public.academy_acknowledgements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "staff read acks" on public.academy_acknowledgements;
create policy "staff read acks" on public.academy_acknowledgements
  for select using (is_admin());

do $pub$ begin alter publication supabase_realtime add table public.academy_assignments; exception when duplicate_object then null; end $pub$;
do $pub$ begin alter publication supabase_realtime add table public.academy_acknowledgements; exception when duplicate_object then null; end $pub$;

-- ============================================================
-- 0032_event_archive.sql
-- ============================================================
-- 0032_event_archive.sql
-- Let operators file completed events out of their active workspace without
-- losing the record (kept for AAR / due-diligence). Archiving also closes the
-- event (the app clears is_live), so nothing stays "live" after it's done.
alter table public.events add column if not exists archived_at timestamptz;

-- fast lookup of the active (non-archived) set the operator actually works
create index if not exists events_active_idx on public.events (archived_at) where archived_at is null;

-- ============================================================
-- 0033_stop_vendor.sql
-- ============================================================
-- 0033_stop_vendor.sql
-- Vendor / location management on truck stops: a point of contact, dates of
-- service, and archive (file a venue out of the active list without deleting the
-- record). Mirrors the event-archive pattern (0032).
alter table public.stops
  add column if not exists poc_name      text,
  add column if not exists poc_phone     text,
  add column if not exists poc_email     text,
  add column if not exists service_dates text,
  add column if not exists archived_at   timestamptz;

-- fast lookup of the active (non-archived) locations the operator works
create index if not exists stops_active_idx on public.stops (archived_at) where archived_at is null;

-- ============================================================
-- 0034_vendors.sql
-- ============================================================
-- 0034_vendors.sql
-- Vendors / venues as ONE relational entity shared by truck stops AND events.
-- One record per venue/partner (name, point of contact, location, dates of
-- service); a stop or an event links to it via vendor_id. POC is owner-sensitive,
-- so vendors is admin-only; the public location stays denormalized on the
-- (world-readable) stops/events rows so guest pages never join this table.
create table if not exists public.vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'New vendor',
  poc_name      text,
  poc_phone     text,
  poc_email     text,
  address       text,
  location_text text,
  lat           double precision,
  lng           double precision,
  service_dates text,
  notes         text,
  archived_at   timestamptz,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.vendors enable row level security;
drop policy if exists "vendors admin all" on public.vendors;
create policy "vendors admin all" on public.vendors
  for all using (is_admin()) with check (is_admin());
do $pub$ begin alter publication supabase_realtime add table public.vendors; exception when duplicate_object then null; end $pub$;

-- link both schedulable surfaces to the canonical vendor record
alter table public.stops  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
alter table public.events add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

-- ============================================================
-- 0035_admin_guard_fix.sql
-- ============================================================
-- 0035_admin_guard_fix.sql
-- Fix silently-failing admin writes. The client grants back-office access via the
-- legacy profiles.is_admin boolean (roleOf() falls back to it), but is_admin() /
-- is_staff() only checked the role column. A user with is_admin=true and role='member'
-- could open the back office yet have every admin WRITE filtered by RLS to 0 rows 
-- e.g. "Go offline" returns no error but is_live never flips. Honor BOTH signals,
-- and re-sync any legacy admin whose role was never backfilled.

create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role in ('admin','owner') or is_admin = true)
  );
$$;

create or replace function public.is_staff() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role <> 'member' or is_admin = true)
  );
$$;

-- promote legacy admins that were left at the default role (the bug case)
update public.profiles set role = 'owner' where is_admin = true and role = 'member';

-- belt-and-suspenders: make sure your account can write (owner)
update public.profiles set role = 'owner' where is_admin = true and role <> 'owner';
