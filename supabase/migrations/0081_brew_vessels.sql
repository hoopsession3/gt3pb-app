-- 0081 — brew vessels. A batch is brewed in a physical vessel with a real capacity, so the planner
-- asks "which vessel am I brewing in?" and sizes the batch to it (× how many vessels). Recipes still
-- scale exactly to the resulting gallons. Seeded with GT3's actual gear: the Toddy (2.5 gal, filter
-- bag) and the Cold Brew Avenue (5 gal, filter basket + tap).

create table if not exists public.brew_vessels (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name         text not null,
  capacity_gal numeric not null default 1,
  filter_type  text,
  notes        text,
  sort         int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.brew_batches add column if not exists vessel text; -- e.g. '2× Toddy (2.5 gal)'

alter table public.brew_vessels enable row level security;
create policy brew_vessels_read  on public.brew_vessels for select using (public.is_staff());
create policy brew_vessels_write on public.brew_vessels for all    using (public.is_admin()) with check (public.is_admin());

insert into public.brew_vessels (name, capacity_gal, filter_type, notes, sort)
select 'Toddy (commercial)', 2.5, 'filter bag', 'Toddy commercial cold-brew system — 2.5 gal, paper/cloth filter bag.', 0
where not exists (select 1 from public.brew_vessels where name = 'Toddy (commercial)');

insert into public.brew_vessels (name, capacity_gal, filter_type, notes, sort)
select 'Cold Brew Avenue', 5.0, 'filter basket + tap', 'Stainless cold-brew vessel — ~5 gal, perforated filter basket, bottom tap.', 1
where not exists (select 1 from public.brew_vessels where name = 'Cold Brew Avenue');
