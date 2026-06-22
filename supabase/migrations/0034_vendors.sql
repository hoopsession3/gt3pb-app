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
alter publication supabase_realtime add table public.vendors;

-- link both schedulable surfaces to the canonical vendor record
alter table public.stops  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
alter table public.events add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
