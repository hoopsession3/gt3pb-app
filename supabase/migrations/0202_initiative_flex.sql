-- 0202 — Flexible initiatives: a milestone can belong to ONE OR MANY initiatives, be moved freely, and
-- be tied to several at once. The single-owner initiative_id from 0201 was too rigid (some seeded
-- milestones belong to a different go-live than the Aug-1 launch). This adds a many-to-many join as the
-- source of truth for placement; initiative_id stays as the "created-under" default but is no longer
-- required. Backfills every existing link so nothing is lost. Staff read; admins manage. Idempotent.

create table if not exists public.initiative_milestone_links (
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  milestone_id  uuid not null references public.initiative_milestones(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (initiative_id, milestone_id)
);
create index if not exists iml_milestone_idx on public.initiative_milestone_links (milestone_id);

-- Backfill: every milestone's current single owner becomes a link.
insert into public.initiative_milestone_links (initiative_id, milestone_id)
  select initiative_id, id from public.initiative_milestones where initiative_id is not null
  on conflict do nothing;

-- Placement now lives in the join, so the single column is optional.
alter table public.initiative_milestones alter column initiative_id drop not null;

drop trigger if exists stamp_tenant_tg on public.initiative_milestone_links;
create trigger stamp_tenant_tg before insert on public.initiative_milestone_links
  for each row execute function public.stamp_tenant();

alter table public.initiative_milestone_links enable row level security;
drop policy if exists "iml staff read" on public.initiative_milestone_links;
create policy "iml staff read" on public.initiative_milestone_links for select using ((select public.is_staff()));
drop policy if exists "iml admin write" on public.initiative_milestone_links;
create policy "iml admin write" on public.initiative_milestone_links for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.initiative_milestone_links;
create policy "tenant isolation" on public.initiative_milestone_links as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.initiative_milestone_links to authenticated;

-- Split the seed I got wrong: the Greater Greenville event (Jul 31) is its OWN go-live, not an Aug-1
-- milestone. Give it its own initiative and re-tie that milestone to it (keeping any other links).
insert into public.initiatives (id, title, summary, target_date, status, emoji)
select '00000000-0000-0000-0000-0000000a0731', 'Greater Greenville — Jul 31',
  'The Jul 31 Greater Greenville event go-live (a separate go-live from the Aug-1 launch).',
  '2026-07-31', 'active', '📍'
where not exists (select 1 from public.initiatives where title = 'Greater Greenville — Jul 31');

-- move the Greenville milestone's link from Aug-1 → Greenville (only if it's still solely on Aug-1)
do $$
declare gv uuid; aug uuid; grn uuid;
begin
  select id into gv  from public.initiative_milestones where title ilike 'Greater Greenville%go live%' limit 1;
  select id into aug from public.initiatives where title = 'Aug 1 Launch' limit 1;
  select id into grn from public.initiatives where title = 'Greater Greenville — Jul 31' limit 1;
  if gv is not null and grn is not null then
    insert into public.initiative_milestone_links (initiative_id, milestone_id) values (grn, gv) on conflict do nothing;
    if aug is not null then delete from public.initiative_milestone_links where initiative_id = aug and milestone_id = gv; end if;
  end if;
end $$;

-- verify:
--   select i.title, count(l.*) from initiatives i left join initiative_milestone_links l on l.initiative_id=i.id group by 1;
