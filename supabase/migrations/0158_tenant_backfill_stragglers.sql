-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0158 · TENANT BACKFILL FOR STRAGGLERS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0153 part 2's dynamic loop put the RESTRICTIVE "tenant isolation" policy on every table carrying
-- a tenant_id column — but part 1's default+backfill ran over an explicit four-table list. Any
-- table outside that list with NULL tenant_id rows (customers, from 0151) became invisible to every
-- client session: NULL = effective_tenant() is not true, and restrictive policies AND together.
-- Surfaced the day the CRM became the first client reader of `customers`.
--
-- Fix, generically: every table with a tenant_id column gets the founding-tenant default and a
-- NULL backfill — the same treatment 0153 gave its four. Idempotent; fills NULLs only;
-- single-tenant behavior unchanged.
do $$
declare r record;
begin
  for r in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I alter column tenant_id set default %L', r.tbl, '00000000-0000-0000-0000-000000000001');
    execute format('update public.%I set tenant_id = %L where tenant_id is null', r.tbl, '00000000-0000-0000-0000-000000000001');
  end loop;
end $$;

-- verify:
--   select count(*) as null_tenant_customers from public.customers where tenant_id is null;  -- 0
--   select count(*) as customers from public.customers;                                       -- > 0
