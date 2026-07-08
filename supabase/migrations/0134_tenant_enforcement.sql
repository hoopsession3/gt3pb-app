-- 0134 — TENANT ENFORCEMENT (closes the DB half of risk R-002). Paste into Supabase → SQL Editor →
-- Run. Idempotent.
--
-- 0040 laid the spine (tenants, tenant_id columns, current_tenant()) but enforced nothing: staff of
-- a future tenant B could read tenant A through PostgREST, and the app never stamps tenant_id.
-- This migration makes the DATABASE do both, without touching app code and without changing any
-- behavior for today's single tenant:
--
--   1. effective_tenant() — the caller's tenant, with anon/guest traffic resolving to the founding
--      GT3 tenant (public surfaces ARE GT3's until per-tenant domains exist).
--   2. A BEFORE INSERT trigger on every tenant_id table stamps the caller's tenant. A signed-in
--      user's profile tenant WINS over anything passed in — tenant-B staff physically cannot write
--      rows into tenant A. Anon inserts keep the column default (GT3).
--   3. A RESTRICTIVE RLS policy ("tenant isolation") on every tenant_id table that already has RLS
--      enabled. Restrictive policies AND onto the existing permissive ones, so nothing existing
--      loosens — each table's own rules still apply, PLUS rows must belong to your tenant.
--      Tables with RLS off are deliberately left alone (see verify) so no public surface breaks.
--
-- Service-role code (supabaseAdmin) bypasses RLS by design — scoping those routes in app code is
-- the remaining half of R-002, tracked in the risk register.

-- 1) Caller's tenant with the anon → founding-tenant fallback.
create or replace function public.effective_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.current_tenant(), '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- 2) Stamp: the caller's profile tenant wins; anon keeps default; never leaves null.
create or replace function public.stamp_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.tenant_id := coalesce(public.current_tenant(), new.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  return new;
end $$;

-- Newer business tables (created after 0040) join the tenancy spine the same way 0040 did.
do $$
declare
  t text;
begin
  foreach t in array array['products','reviews','alerts'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) default %L', t, '00000000-0000-0000-0000-000000000001');
      execute format('update public.%I set tenant_id = %L where tenant_id is null', t, '00000000-0000-0000-0000-000000000001');
      execute format('create index if not exists %I on public.%I(tenant_id)', t||'_tenant_idx', t);
    end if;
  end loop;
end $$;

-- 3) Trigger + restrictive policy across every table that carries tenant_id (dynamic, so tables
--    added later with a tenant_id column are picked up when this file re-runs).
do $$
declare
  r record;
begin
  for r in
    select c.relname as tbl, c.relrowsecurity as rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  loop
    -- stamping trigger (all tenant_id tables, RLS or not)
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', r.tbl);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', r.tbl);
    -- isolation policy (only where RLS is already enforced — leaves RLS-off tables byte-identical)
    if r.rls_on then
      execute format('drop policy if exists "tenant isolation" on public.%I', r.tbl);
      execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', r.tbl);
    end if;
  end loop;
end $$;

-- Staff see their OWN tenant row only (a tenant-B owner can't enumerate other customers).
drop policy if exists "tenants staff read" on public.tenants;
create policy "tenants staff read" on public.tenants
  for select using ((select public.is_staff()) and id = public.effective_tenant());

-- verify (after running):
--   -- every tenant_id table has the trigger:
--   select tgrelid::regclass from pg_trigger where tgname = 'stamp_tenant_tg' order by 1;
--   -- isolation policy coverage (RLS-on tables with tenant_id):
--   select polrelid::regclass from pg_policy where polname = 'tenant isolation' order by 1;
--   -- tenant_id tables where RLS is OFF (decide per table before tenant #2 onboards):
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
--     and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped);
--   -- business tables still lacking tenant_id entirely (same decision list):
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname='public' and c.relkind='r'
--     and not exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
--   order by 1;
--
-- two-tenant smoke (run with a SCRATCH tenant, then delete it):
--   insert into public.tenants (id, slug, name) values ('00000000-0000-0000-0000-0000000000t2'::uuid, 'scratch', 'Scratch') -- use a real uuid
--   -- then set one test user's profiles.tenant_id to it, sign in as them, and confirm
--   -- /admin lists NO GT3 events/orders/products, and their inserts land with their tenant_id.
