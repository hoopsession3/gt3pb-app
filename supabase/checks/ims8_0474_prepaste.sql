-- IMS8 · 0474 PRE-PASTE CHECK (read-only; names, booleans and md5 fingerprints only). Run AFTER 0473 is pasted and the
-- review-branch app is live and checked, BEFORE pasting 0474. Every row should say t; any f → stop.
-- Fingerprints: md5 of the body, whitespace runs made one space, ends trimmed — the replay's values with 0473 applied
-- (PGlite, 2026-11-03). If production's paste of 0473 is exact, they match. 2026-11-20: 0475 (held, independent) may be
-- applied before 0474 — course_status and the ledger rows accept either order.
with want(fn, md5_ws) as (values
  ('vision_shared',              'bfde7657f3cb2a57df06051c9c58b6b1'),
  ('set_shop_order_status',      '3c308be832ef20e4cbd5ca524140a553'),
  ('std_research_settle_server', 'b568933a35b841adabab451f985266b4'),
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
select 'course_status is 0473''s or 0475''s (0475 may go first; 0474 never touches it)',
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'course_status' and p.prosecdef
                and md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) in ('0bcb9496067b7d2030049a734f7e0da4', '4556ee02123875c4c30bceaa16b2b4ae'))
union all
select 'ledger: 0473 in, 0474 not (0475 may be in; above it only the verified 0476 and 0477)',
       exists (select 1 from public.schema_migrations where version like '0473%')
       and not exists (select 1 from public.schema_migrations where version like '0474%')
       -- 2026-11-24: 0476 and 0477 were applied and verified in production on 2026-11-23 (they never touch what 0474
       -- changes). Exactly those two names are accepted above 0475; any other row from 0476 up is drift → f.
       and not exists (select 1 from public.schema_migrations where version >= '0476'
                        and version not in ('0476_recipes_are_kept_in_the_app', '0477_recipe_versions_api_writes_only'));
