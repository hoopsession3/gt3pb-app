-- 0096 — KEG INVENTORY. The bottle/keg pack-out split assumed 5-gal corny kegs (ceil(gal/5)); that's
-- wrong for a mixed fleet. This stores Ryan's real serving kegs so the split allocates to the actual
-- vessels, and the event-level pack planner can reason across all batches. Seeds his current kegs.

create table if not exists public.kegs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name         text not null,
  capacity_gal numeric not null,
  qty          int not null default 1,
  sort         int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.kegs enable row level security;
create policy kegs_read  on public.kegs for select using (public.is_staff());
create policy kegs_write on public.kegs for all    using (public.is_admin()) with check (public.is_admin());

-- seed the current fleet only if empty (idempotent)
insert into public.kegs (name, capacity_gal, qty, sort)
select * from (values
  ('2 gal Torpedo keg', 2::numeric, 3, 0),
  ('5 gal keg',         5::numeric, 2, 1)
) as v(name, capacity_gal, qty, sort)
where not exists (select 1 from public.kegs);
