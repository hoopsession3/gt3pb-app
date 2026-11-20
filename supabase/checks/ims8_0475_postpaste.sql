-- IMS8 · 0475 POST-PASTE CHECK (read-only). Run right after pasting 0475. Every row should say t.
select 'course_status is 0475''s (owner/admin check)' as what,
       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'course_status' and p.prosecdef
                and md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) = '4556ee02123875c4c30bceaa16b2b4ae'
                and p.prosrc ~ 'is_admin\(\)' and p.prosrc !~ 'is_staff\(\)') as as_expected
union all
select 'course_status: same grants (signed in yes, signed out no)',
       has_function_privilege('authenticated', 'public.course_status(uuid)', 'execute') and not has_function_privilege('anon', 'public.course_status(uuid)', 'execute')
union all
select 'course_status: search_path pinned', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'course_status'
                and p.proconfig @> array['search_path=public'])
union all
select 'ledger: 0475 recorded', exists (select 1 from public.schema_migrations where version = '0475_a_course_line_is_the_owners_and_admins')
union all
select '0474 untouched by this paste (customers staff read still there unless 0474 was applied)',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname in ('customers staff read', 'customers admin read'));
