-- IMS8 · 0473 PRE-PASTE CHECK (read-only; names, booleans and md5 fingerprints only — no function text is printed).
-- 0473 replaces three functions and six policies on the assumption that production has the repo's versions. The
-- policies were compared 2026-11-03 against the security snapshot pulled that day (12 of 12 identical, replay vs
-- production). The functions' bodies were NOT all re-read: course_students and vision_shared were (identical modulo
-- whitespace); set_shop_order_status was not. Run this first; every row should say t. Any f → stop, don't paste.
--
-- Fingerprint: md5 of the body with every run of whitespace made one space and the ends trimmed — the replay's values
-- (PGlite, migrations up to 0472), computed 2026-11-03.
with want(fn, args, md5_ws) as (values
  ('course_students',       '',                                                                    '22e9022013c3832c09388dc222935fec'),
  ('set_shop_order_status', 'p_order uuid, p_status text, p_note text, p_refund_cents integer',     '217eeabcf847e45667e6a69fe534638a'),
  ('std_research_settle',   'p_run uuid, p_usage jsonb, p_cost_cents numeric, p_outcome text, p_error text', 'dfd6a51a60369934fb2831b3663a4c44'),
  ('vision_shared',         'p_token text',                                                        '99be03a96ecd0a864d742693249cff07')
)
select 'function ' || w.fn as what,
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = w.fn
                and pg_get_function_identity_arguments(p.oid) = w.args and p.prosecdef
                and md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) = w.md5_ws) as as_expected
  from want w
union all
select 'policy ' || t || ' / ' || n, exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = n)
  from (values ('program_access','access owner read'), ('program_access','access staff manage'),
               ('shop_orders','shop orders staff manage'), ('shop_order_items','shop items staff manage'),
               ('merch_fulfillments','fulfillments staff')) v(t, n)
union all
select 'not yet: course_status',              not exists (select 1 from pg_proc where proname = 'course_status')
union all
select 'not yet: customers_total',            not exists (select 1 from pg_proc where proname = 'customers_total')
union all
select 'not yet: std_research_settle_server', not exists (select 1 from pg_proc where proname = 'std_research_settle_server')
union all
select 'ledger ends at 0472',                 (select max(version) from public.schema_migrations) like '0472%'
union all
select 'no research run is mid-flight',       not exists (select 1 from public.std_research_runs where outcome = 'running');
