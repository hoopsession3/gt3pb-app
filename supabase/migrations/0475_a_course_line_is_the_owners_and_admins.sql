-- 0475 · A COURSE LINE IS THE OWNER'S AND ADMINS' (HELD — see supabase/held.json)
--
-- Why: 0473 let any crew member of the business call course_status(customer) — the line without payment or note — for
-- the customer record. Since a1362171 the order sheet links a customer's name to their record for owners and admins only,
-- so no crew screen reaches a customer record, and the crew branch of course_status serves no journey (IMS8-STATUS,
-- "The 13 functions", row 6; D5: crew access only for a demonstrated operational need).
--
-- What changes: the caller check, from is_staff() to is_admin(). Same signature, same grant (authenticated), same columns;
-- payment and note were already owner/admin only. An operator's call now returns no row (the same answer a member gets),
-- not an error — the app's customer record is never opened by an operator, so nothing in the app changes.
--
-- What doesn't: the count of callable privileged functions (140) — this narrows who passes the check, not who may call.
--
-- Rollback: re-run 0473's course_status definition (lines 104–124). Safe with 0474 held or applied (independent objects).
-- Post-check:  select pg_get_functiondef('public.course_status(uuid)'::regprocedure) ~ 'is_admin\(\)\);' -- t
-- lock-timeout: none — replaces one function's body (no table is altered or locked); applied 2026-11-20 11:13:19 UTC
-- changelog: none — an internal permission narrowing; no app or customer-visible change
create or replace function public.course_status(p_customer uuid)
returns table (source text, granted_at timestamptz, revoked_at timestamptz, paid_cents int, note text,
               done int, total int, rookie_done int, rookie_total int, last_done_at timestamptz)
language sql stable security definer set search_path = public as $$
  with live as (
    select l.id, l.tier from public.primal_lessons l
     where l.published_at is not null and l.archived_at is null and l.tenant_id = public.effective_tenant()
  )
  select pa.source, pa.granted_at, pa.revoked_at,
         (select o.total_cents from public.shop_orders o where o.id = pa.order_id),
         pa.note,
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed'),
         (select count(*)::int from live),
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed' and live.tier = 'rookie'),
         (select count(*)::int from live where live.tier = 'rookie'),
         (select max(p.completed_at) from public.primal_progress p where p.customer_id = pa.customer_id and p.status = 'completed')
    from public.program_access pa
   where pa.customer_id = p_customer and pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and coalesce(public.is_admin(), false);
$$;
revoke all on function public.course_status(uuid) from public, anon, authenticated;
grant execute on function public.course_status(uuid) to authenticated;

select public.record_migration('0475_a_course_line_is_the_owners_and_admins');
