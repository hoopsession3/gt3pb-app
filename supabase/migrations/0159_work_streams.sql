-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0159 · WORK STREAMS — the business's operating lanes, as tenant config
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Categories (stop/event/brew/drop/…) stay the atomic "what kind of thing is this"; a work stream
-- rolls many categories into one accountable lane with an owner. Table-backed (not a code constant)
-- so every tenant renames/reshapes their own lanes — a food truck's "Production" is another
-- operator's "Kitchen". This is the org-structure spine: Rails view lanes, OrgChart ownership
-- cards, and (next) alert escalation all read it.
--
-- 0158's lesson applied at creation: tenant_id carries the founding default, the stamp trigger is
-- attached here, and the restrictive tenant policy is created here — not left for a future loop.

create table if not exists public.work_streams (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  key           text not null,
  label         text not null,
  color         text not null default '#8a8a8a',
  categories    text[] not null default '{}',   -- calendar + alert categories that roll up here
  sections      text[] not null default '{}',   -- OpSections this lane lives in
  owner_role    text,                            -- default accountable role
  owner_user_id uuid references public.profiles(id) on delete set null,  -- the accountable human
  sort          int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (tenant_id, key)
);

alter table public.work_streams enable row level security;
drop policy if exists "work_streams staff read" on public.work_streams;
create policy "work_streams staff read"  on public.work_streams for select using ((select public.is_staff()));
drop policy if exists "work_streams admin write" on public.work_streams;
create policy "work_streams admin write" on public.work_streams for all using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists stamp_tenant_tg on public.work_streams;
create trigger stamp_tenant_tg before insert on public.work_streams for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.work_streams;
create policy "tenant isolation" on public.work_streams as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- The founding tenant's five lanes. Colors inherit each lane's dominant category hue so chips and
-- rails read as one system. Idempotent: existing rows (renamed lanes, assigned owners) untouched.
insert into public.work_streams (tenant_id, key, label, color, categories, sections, owner_role, sort) values
  ('00000000-0000-0000-0000-000000000001', 'service',    'Service',    '#5b9a6b', '{stop,drop,delivery,order,prep}',        '{now,prep}',             'operator',      1),
  ('00000000-0000-0000-0000-000000000001', 'events',     'Events',     '#6fa8dc', '{event,booking,ops}',                    '{plan,prep}',            'event_manager', 2),
  ('00000000-0000-0000-0000-000000000001', 'production', 'Production', '#c9a227', '{brew,inventory}',                       '{plan}',                 'operator',      3),
  ('00000000-0000-0000-0000-000000000001', 'brand',      'Brand',      '#2bb3a3', '{content}',                              '{studio}',               'admin',         4),
  ('00000000-0000-0000-0000-000000000001', 'business',   'Business',   '#8b5cf6', '{money,admin,strategy,task,system}',     '{money,customers,team}', 'owner',         5)
on conflict (tenant_id, key) do nothing;

-- verify:
--   select count(*) as streams from public.work_streams;                       -- 5
--   select count(*) as ws_policies from pg_policies where tablename = 'work_streams';  -- 3
