-- 0239 — Tenant isolation for the four B2B office tables. They were created in 0187 (after the 0134
-- one-time tenant-enforcement loop), so they got a tenant_id column + a stamp_tenant trigger + RLS —
-- but never the canonical RESTRICTIVE "tenant isolation" policy. Their only policies are `is_staff()`
-- (role-only, NOT tenant-scoped), so the moment a SECOND tenant onboards, tenant B's staff/owner can
-- read and write ALL of tenant A's office accounts, orders, jug ledger, and invoices.
--
-- This adds the exact policy every other isolated table uses (0134). It is a NO-OP for the current
-- single tenant (every row is stamped with effective_tenant(), so the predicate is always true today);
-- it only starts filtering once a second tenant exists. Additive, reversible, no data change.

-- business_accounts
drop policy if exists "tenant isolation" on public.business_accounts;
create policy "tenant isolation" on public.business_accounts as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- business_orders
drop policy if exists "tenant isolation" on public.business_orders;
create policy "tenant isolation" on public.business_orders as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- jug_ledger
drop policy if exists "tenant isolation" on public.jug_ledger;
create policy "tenant isolation" on public.jug_ledger as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- invoices
drop policy if exists "tenant isolation" on public.invoices;
create policy "tenant isolation" on public.invoices as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- verify:
--   select tablename, policyname, permissive from pg_policies
--   where tablename in ('business_accounts','business_orders','jug_ledger','invoices') order by 1,2;
--   -- each table should now list a RESTRICTIVE "tenant isolation" policy alongside its staff/own ones.
