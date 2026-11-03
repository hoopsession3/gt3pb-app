-- IMS8 · 0474 PRE-PASTE CHECK (read-only; names, booleans and md5 fingerprints only). Run AFTER 0473 is pasted and the
-- review-branch app is live and checked, BEFORE pasting 0474. Every row should say t; any f → stop.
-- Fingerprints: md5 of the body, whitespace runs made one space, ends trimmed — the replay's values with 0473 applied
-- (PGlite, 2026-11-03). If production's paste of 0473 is exact, they match.
with want(fn, md5_ws) as (values
  ('vision_shared',              'bfde7657f3cb2a57df06051c9c58b6b1'),
  ('set_shop_order_status',      '3c308be832ef20e4cbd5ca524140a553'),
  ('std_research_settle_server', 'b568933a35b841adabab451f985266b4'),
  ('course_status',              '0bcb9496067b7d2030049a734f7e0da4'),
  ('customers_total',            '31cb262f66d6b40746a189703052d2fd')
)
select '0473 function ' || w.fn as what,
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = w.fn and p.prosecdef
                and md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) = w.md5_ws) as as_expected
  from want w
union all
select 'policy customers / customers staff read (0474 removes it)', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers staff read')
union all
select 'not yet: customers admin read', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers admin read')
union all
select 'ledger ends at 0473', (select max(version) from public.schema_migrations) like '0473%';
