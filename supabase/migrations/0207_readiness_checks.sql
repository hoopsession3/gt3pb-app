-- 0207 — Launch readiness: a go/no-go board. Initiatives (0201) already carry a countdown + milestone
-- progress, but "are we actually ready to launch?" is a different question than "are the deliverables
-- done" — it's a checklist of gating conditions, each ready / at-risk / blocked, owned, and rolled up
-- to one verdict. General capability: any initiative gets a readiness board, not just Aug-1. Staff-only
-- (internal). Idempotent + additive.

create table if not exists public.readiness_checks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  initiative_id uuid references public.initiatives(id) on delete cascade,
  label         text not null,
  category      text,                                                    -- ops | money | product | people | legal | marketing
  status        text not null default 'at_risk' check (status in ('ready','at_risk','blocked')),
  critical      boolean not null default true,                           -- only critical checks gate the verdict
  owner_id      uuid references auth.users(id) on delete set null,
  note          text,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists readiness_init_idx on public.readiness_checks (initiative_id, sort);

drop trigger if exists stamp_tenant_tg on public.readiness_checks;
create trigger stamp_tenant_tg before insert on public.readiness_checks
  for each row execute function public.stamp_tenant();

alter table public.readiness_checks enable row level security;
drop policy if exists "readiness staff read" on public.readiness_checks;
create policy "readiness staff read" on public.readiness_checks for select using ((select public.is_staff()));
drop policy if exists "readiness staff write" on public.readiness_checks;
create policy "readiness staff write" on public.readiness_checks for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.readiness_checks;
create policy "tenant isolation" on public.readiness_checks as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.readiness_checks to authenticated;

-- Seed a general launch-readiness set for the Aug-1 launch initiative. Honest starting truth:
-- backups are the one hard blocker (free-tier prod, no backups), VIP verification just shipped.
insert into public.readiness_checks (initiative_id, label, category, status, critical, sort)
select v.initiative_id, v.label, v.category, v.status, v.critical, v.sort from (values
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Payments live end to end',            'money',     'at_risk', true,  10),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Menu and pricing finalized',           'product',   'at_risk', true,  20),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Inventory stocked to reorder points',  'ops',       'at_risk', true,  30),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Crew scheduled and roles assigned',    'people',    'at_risk', true,  40),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Delivery zones and office route ready','ops',       'at_risk', true,  50),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Database backups enabled',             'ops',       'blocked', true,  60),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'VIP verification live',                'product',   'ready',   false, 70),
  ('00000000-0000-0000-0000-0000000a0801'::uuid, 'Launch announcement and content ready','marketing', 'at_risk', false, 80)
) as v(initiative_id, label, category, status, critical, sort)
where exists (select 1 from public.initiatives i where i.id = v.initiative_id)
  and not exists (select 1 from public.readiness_checks r where r.initiative_id = v.initiative_id and r.label = v.label);

-- verify:
--   select to_regclass('public.readiness_checks');                                  -- not null
--   select status, count(*) from public.readiness_checks group by 1;               -- seeded rows
