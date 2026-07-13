-- 0201 — Initiatives (the program layer) + the shared Command Board's data.
-- An initiative is a DATED program that rolls up MANY workstreams under one goal with milestones and a
-- countdown — the thing goals (which roll up to exactly one lane) can't represent, and the thing the
-- Aug-1 launch needs. Work rolls up to an initiative via a nullable FK on BOTH task tables (event_tasks
-- and todos) — reconciling the two-table split at the link level instead of adding a third task store.
-- Staff read; admins (the two owners) manage. Idempotent.

create table if not exists public.initiatives (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title       text not null,
  summary     text,
  target_date date,                                         -- the launch / deadline the countdown reads
  status      text not null default 'active' check (status in ('planning','active','done','paused')),
  emoji       text,                                         -- a glanceable marker on the board
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.initiative_milestones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  title         text not null,
  due_on        date,
  done          boolean not null default false,
  done_at       timestamptz,
  workstream    text,                                       -- content · events · delivery · branding · vip · logistics
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists milestone_init_idx on public.initiative_milestones (initiative_id, sort);

-- Roll work up to an initiative (both task engines).
alter table public.todos       add column if not exists initiative_id uuid references public.initiatives(id) on delete set null;
alter table public.event_tasks add column if not exists initiative_id uuid references public.initiatives(id) on delete set null;

-- tenant stamping + RLS
drop trigger if exists stamp_tenant_tg on public.initiatives;
create trigger stamp_tenant_tg before insert on public.initiatives for each row execute function public.stamp_tenant();
drop trigger if exists stamp_tenant_tg on public.initiative_milestones;
create trigger stamp_tenant_tg before insert on public.initiative_milestones for each row execute function public.stamp_tenant();

alter table public.initiatives enable row level security;
alter table public.initiative_milestones enable row level security;
drop policy if exists "initiatives staff read" on public.initiatives;
create policy "initiatives staff read" on public.initiatives for select using ((select public.is_staff()));
drop policy if exists "initiatives admin write" on public.initiatives;
create policy "initiatives admin write" on public.initiatives for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "milestones staff read" on public.initiative_milestones;
create policy "milestones staff read" on public.initiative_milestones for select using ((select public.is_staff()));
drop policy if exists "milestones admin write" on public.initiative_milestones;
create policy "milestones admin write" on public.initiative_milestones for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.initiatives;
create policy "tenant isolation" on public.initiatives as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
drop policy if exists "tenant isolation" on public.initiative_milestones;
create policy "tenant isolation" on public.initiative_milestones as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.initiatives to authenticated;
grant select, insert, update, delete on public.initiative_milestones to authenticated;

-- Seed the real Aug-1 launch from the planning meeting (idempotent by title).
insert into public.initiatives (id, title, summary, target_date, status, emoji)
select '00000000-0000-0000-0000-0000000a0801', 'Aug 1 Launch',
  'The end-of-July to Aug-1 launch across content, events, delivery, branding, VIP verification and logistics.',
  '2026-08-01', 'active', '🚀'
where not exists (select 1 from public.initiatives where title = 'Aug 1 Launch');

insert into public.initiative_milestones (initiative_id, title, due_on, workstream, sort)
select '00000000-0000-0000-0000-0000000a0801', v.title, v.due::date, v.ws, v.srt
from (values
  ('Finalize logo designs — shirts, car magnets, digital','2026-07-16','branding',1),
  ('Rent the Tesla for Atlanta delivery + content','2026-07-15','logistics',2),
  ('Atlanta content photoshoot (Jul 17-19)','2026-07-19','content',3),
  ('Decide delivery-launch timing + contingency','2026-07-25','delivery',4),
  ('Load the Jul 31 + Aug 1 events in the app','2026-07-25','events',5),
  ('Ship the VIP verification flow','2026-07-28','vip',6),
  ('Greater Greenville event — go live (Jul 31)','2026-07-31','events',7),
  ('Aug 1 launch event — go live','2026-08-01','events',8)
) as v(title, due, ws, srt)
where not exists (select 1 from public.initiative_milestones m
  where m.initiative_id = '00000000-0000-0000-0000-0000000a0801' and m.title = v.title);

-- verify:
--   select title, target_date, status from public.initiatives;
--   select count(*) done, (select count(*) from initiative_milestones) total from initiative_milestones where done;
