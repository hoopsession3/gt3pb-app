-- 0355's dry run: what pasting supabase/migrations/0355_every_office_order_belongs_to_a_company.sql
-- will create and link, read from today's data. Read-only: counts and sums, no names.
--
-- Run it in the SQL editor before 0355 (the report's rule: "before applying anything to production,
-- a dry run reports the counts and totals for your OK"), and the last three rows again after: they
-- must not move, because 0355 adds links and records and changes no amount anyone reads.
select 'office accounts → a company and a location each' as item, count(*)::text as result from public.business_accounts
union all select '…with a weekly order → a program (on / paused)',
  (count(*) filter (where standing_active))::text || ' / ' || (count(*) filter (where not standing_active))::text
  from public.business_accounts where standing_gallons is not null
union all select '…with a person → that person as admin', count(*)::text from public.business_accounts where user_id is not null
union all select 'office orders', count(*)::text from public.business_orders
union all select '…one-offs with no account', count(*)::text from public.business_orders where business_id is null
union all select '…their companies, at most (person + name; some join an account''s)',
  count(distinct (coalesce(user_id::text, ''), lower(btrim(company))))::text from public.business_orders where business_id is null
union all select 'invoices / jug entries / deals wired to an account',
  (select count(*) from public.invoices)::text || ' / ' || (select count(*) from public.jug_ledger)::text || ' / '
  || (select count(*) from public.opportunities where business_account_id is not null)::text
union all select 'order total, cents — unchanged after', coalesce(sum(total_cents), 0)::text from public.business_orders
union all select 'invoice total, cents — unchanged after', coalesce((select sum(amount_cents) from public.invoices), 0)::text
union all select 'jug balances — unchanged after', coalesce((select sum(jug_balance) from public.business_accounts), 0)::text;
