-- 0082 — asset maintenance log. A place to track upkeep of the gear (assets): each service, repair,
-- clean, inspection or note is a dated log entry against an asset, with an optional next-due date so
-- the app can flag what's coming up or overdue. Same traceability standard as batch logging.

create table if not exists public.asset_maintenance (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  asset_id     uuid not null references public.assets(id) on delete cascade,
  kind         text not null default 'service' check (kind in ('service','repair','clean','inspect','calibrate','note')),
  performed_on date not null default current_date,
  summary      text not null,
  next_due_on  date,                 -- when it's due again (drives the "due / overdue" flag)
  cost_cents   int,
  performed_by text,                 -- free-text who did it
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists asset_maintenance_asset_idx on public.asset_maintenance(asset_id);
create index if not exists asset_maintenance_due_idx   on public.asset_maintenance(next_due_on) where next_due_on is not null;

alter table public.asset_maintenance enable row level security;
create policy asset_maint_read   on public.asset_maintenance for select using (public.is_staff());
create policy asset_maint_insert on public.asset_maintenance for insert with check (public.is_staff());
create policy asset_maint_update on public.asset_maintenance for update using (public.is_staff()) with check (public.is_staff());
create policy asset_maint_delete on public.asset_maintenance for delete using (public.is_staff());
