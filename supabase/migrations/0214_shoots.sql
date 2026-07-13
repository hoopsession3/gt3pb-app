-- 0214 — Shoot planning: plan any content shoot (the Atlanta shoot and every one after). A shoot has
-- a date, location, call time, and a shot list; each shot can be assigned and checked off. Reuses the
-- house tenancy + role model (staff read/write). Idempotent + additive.

create table if not exists public.shoots (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title       text not null,
  shoot_date  date,
  location    text,
  call_time   text,                                                   -- free text, e.g. '8:00 AM'
  status      text not null default 'planning' check (status in ('planning','scheduled','wrapped')),
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.shots (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  shoot_id    uuid not null references public.shoots(id) on delete cascade,
  description text not null,
  status      text not null default 'planned' check (status in ('planned','shot','cut')),
  assignee    uuid references auth.users(id) on delete set null,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists shots_shoot_idx on public.shots (shoot_id, sort);

drop trigger if exists stamp_tenant_tg on public.shoots;
create trigger stamp_tenant_tg before insert on public.shoots for each row execute function public.stamp_tenant();
drop trigger if exists stamp_tenant_tg on public.shots;
create trigger stamp_tenant_tg before insert on public.shots for each row execute function public.stamp_tenant();

alter table public.shoots enable row level security;
alter table public.shots  enable row level security;
drop policy if exists "shoots staff" on public.shoots;
create policy "shoots staff" on public.shoots for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "shots staff" on public.shots;
create policy "shots staff" on public.shots for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.shoots;
create policy "tenant isolation" on public.shoots as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
drop policy if exists "tenant isolation" on public.shots;
create policy "tenant isolation" on public.shots as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.shoots to authenticated;
grant select, insert, update, delete on public.shots  to authenticated;

-- verify:
--   select to_regclass('public.shoots'), to_regclass('public.shots');
