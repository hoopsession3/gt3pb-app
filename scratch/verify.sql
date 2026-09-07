select 'table  brew_batch_steps' as obj, (to_regclass('public.brew_batch_steps') is not null)::text as present
union all select 'view   v_batch_progress', (to_regclass('public.v_batch_progress') is not null)::text
union all select 'view   v_promotable',     (to_regclass('public.v_promotable') is not null)::text
union all select 'fn     ' || p.proname, 'yes'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('ensure_batch_steps','set_batch_step','promote_to_crew','set_member_market')
union all select 'rows   v_promotable',   (select count(*)::text from public.v_promotable)
union all select 'rows   v_batch_progress',(select count(*)::text from public.v_batch_progress)
union all select 'rows   batches w/ steps',(select count(*)::text from public.v_batch_progress where steps_total > 0)
union all select 'log    0299', (select count(*)::text from public.changelog where title = 'A customer can be brought onto the crew')
union all select 'log    0300', (select count(*)::text from public.changelog where title = 'Brew steps you can work from, and tick off')
order by 1;
