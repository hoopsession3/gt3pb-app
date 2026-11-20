-- 0475 ROLLBACK — course_status back to 0473's (crew of the business get the line without payment or note). Leaves 0474
-- as it is (applied or held: independent objects). Owner's approval per the release rules. Paste in one go; it ends by
-- taking 0475 off the ledger. Then run supabase/checks/ims8_0475_prepaste.sql: every row t again.
set lock_timeout = '5s';
begin;
create or replace function public.course_status(p_customer uuid)
returns table (source text, granted_at timestamptz, revoked_at timestamptz, paid_cents int, note text,
               done int, total int, rookie_done int, rookie_total int, last_done_at timestamptz)
language sql stable security definer set search_path = public as $$
  with live as (
    select l.id, l.tier from public.primal_lessons l
     where l.published_at is not null and l.archived_at is null and l.tenant_id = public.effective_tenant()
  ), admin as (select coalesce(public.is_admin(), false) a)
  select pa.source, pa.granted_at, pa.revoked_at,
         case when (select a from admin) then (select o.total_cents from public.shop_orders o where o.id = pa.order_id) end,
         case when (select a from admin) then pa.note end,
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed'),
         (select count(*)::int from live),
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed' and live.tier = 'rookie'),
         (select count(*)::int from live where live.tier = 'rookie'),
         (select max(p.completed_at) from public.primal_progress p where p.customer_id = pa.customer_id and p.status = 'completed')
    from public.program_access pa
   where pa.customer_id = p_customer and pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and (select public.is_staff());
$$;
revoke all on function public.course_status(uuid) from public, anon, authenticated;
grant execute on function public.course_status(uuid) to authenticated;
delete from public.schema_migrations where version = '0475_a_course_line_is_the_owners_and_admins';
commit;
