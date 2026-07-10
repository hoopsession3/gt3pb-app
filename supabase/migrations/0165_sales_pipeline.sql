-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0165 · SALES PIPELINE — deals (the owner's offer catalog) + opportunities (the funnel)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The Events lane gets a real pipeline. Three relations:
--   vendors        — the ACCOUNT (existing table; gains vendor_type: gym, corporate, cafe…)
--   deals          — what's on the table, owner-articulated, gated per vendor type. Reps can only
--                    attach a deal that is active AND matches the vendor's type.
--   opportunities  — the funnel: vendor × deal × rep × stage (prospect → first_attempt → talking
--                    → proposal → won/lost) + expected value + the next step with a date.
-- Collaboration rides existing engines: per-opportunity threads (strategy_threads key opp:<id>),
-- rep-assignment pings through the alerts spine. Tenant-first trio on every new table (0158 rule).

-- ── vendors: the account gets a type, and STAFF can finally read/work accounts ───────────────────
alter table public.vendors add column if not exists vendor_type text;
drop policy if exists "vendors staff read" on public.vendors;
create policy "vendors staff read" on public.vendors for select using ((select public.is_staff()));
drop policy if exists "vendors staff write" on public.vendors;
create policy "vendors staff write" on public.vendors
  for insert with check ((select public.is_staff()));
drop policy if exists "vendors staff update" on public.vendors;
create policy "vendors staff update" on public.vendors
  for update using ((select public.is_staff())) with check ((select public.is_staff()));
-- (admin keeps full control incl. delete via the existing "vendors admin all")

-- ── deals: the offer catalog (owner/admin write; everyone reads) ─────────────────────────────────
create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title       text not null,
  blurb       text,
  vendor_type text not null,                 -- which accounts this deal is FOR (gym, corporate, …)
  price_label text,                          -- display terms — "$500/mo", "rev share 20%"
  terms       text,
  active      boolean not null default true, -- reps only see active deals
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.deals enable row level security;
drop policy if exists "deals staff read" on public.deals;
create policy "deals staff read" on public.deals for select using ((select public.is_staff()));
drop policy if exists "deals admin write" on public.deals;
create policy "deals admin write" on public.deals for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop trigger if exists stamp_tenant_tg on public.deals;
create trigger stamp_tenant_tg before insert on public.deals for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.deals;
create policy "tenant isolation" on public.deals as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- ── opportunities: the funnel ────────────────────────────────────────────────────────────────────
create table if not exists public.opportunities (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  deal_id      uuid references public.deals(id) on delete set null,
  rep_id       uuid references public.profiles(id) on delete set null,
  stage        text not null default 'prospect'
                 check (stage in ('prospect','first_attempt','talking','proposal','won','lost')),
  value_cents  int,
  next_step    text,
  next_step_at date,
  source       text not null default 'manual',   -- manual · inbound · scout
  notes        text,
  lost_reason  text,
  won_at       timestamptz,
  lost_at      timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists opportunities_vendor on public.opportunities(vendor_id);
create index if not exists opportunities_rep    on public.opportunities(rep_id);
create index if not exists opportunities_stage  on public.opportunities(stage);
alter table public.opportunities enable row level security;
drop policy if exists "opportunities staff read" on public.opportunities;
create policy "opportunities staff read" on public.opportunities for select using ((select public.is_staff()));
drop policy if exists "opportunities staff write" on public.opportunities;
create policy "opportunities staff write" on public.opportunities
  for insert with check ((select public.is_staff()));
drop policy if exists "opportunities staff update" on public.opportunities;
create policy "opportunities staff update" on public.opportunities
  for update using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "opportunities admin delete" on public.opportunities;
create policy "opportunities admin delete" on public.opportunities for delete using ((select public.is_admin()));
drop trigger if exists stamp_tenant_tg on public.opportunities;
create trigger stamp_tenant_tg before insert on public.opportunities for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.opportunities;
create policy "tenant isolation" on public.opportunities as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- ── the Events lane gains the Pipeline page (guarded: customized lanes untouched) ────────────────
update public.work_streams set sections = '{plan,pipeline,prep}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'events' and sections = '{plan,prep}';

-- verify:
--   select count(*) from pg_policies where tablename = 'deals';           -- 3
--   select count(*) from pg_policies where tablename = 'opportunities';   -- 5
--   select sections from public.work_streams where key = 'events';        -- {plan,pipeline,prep}
