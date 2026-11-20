-- IMS8 · 0475 PRE-PASTE CHECK (read-only; names, booleans and md5 fingerprints only). Run BEFORE pasting 0475.
-- Every row should say t; any f → stop. Works whether 0474 is applied or still held.
select 'course_status is 0473''s (md5 of its body, whitespace made one space)' as what,
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'course_status' and p.prosecdef
                and md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) = '0bcb9496067b7d2030049a734f7e0da4') as as_expected
union all
select 'course_status: callable signed in, not signed out',
       has_function_privilege('authenticated', 'public.course_status(uuid)', 'execute') and not has_function_privilege('anon', 'public.course_status(uuid)', 'execute')
union all
select 'ledger: 0473 in, 0475 not', exists (select 1 from public.schema_migrations where version like '0473%')
       and not exists (select 1 from public.schema_migrations where version like '0475%')
union all
select 'is_admin() exists', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'is_admin');
