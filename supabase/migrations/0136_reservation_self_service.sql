-- 0136 — RESERVATION SELF-SERVICE. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Customers could reserve a pack but never see or manage it again ("as a user I have no way to
-- track my orders / packs"). Reading their own reservations already works (0119 "own drops read");
-- this adds the missing write: a member cancels their OWN reservation through a definer RPC —
-- the same shape as cancel_own_order (0118) for cups. Staff update policy stays staff-only.
--
-- Rules: only the owner, only if not picked up and not already canceled. A PAID cancel raises the
-- same refund alert the staff cancel raises (DropOps), so the crew inbox is the single refund queue.

create or replace function public.cancel_own_reservation(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.drop_orders%rowtype;
begin
  select * into r from public.drop_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.picked_up then return false; end if;
  update public.drop_orders set canceled_at = now() where id = p_id;
  if r.paid then
    insert into public.alerts (severity, category, title, body, link) values (
      'important', 'money', 'Member canceled a PAID reservation — refund needed',
      r.name || ' · ' || r.size || '-pack · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.drop_date, 'Dy Mon DD') || '''s drop. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;

grant execute on function public.cancel_own_reservation(uuid) to authenticated;
revoke execute on function public.cancel_own_reservation(uuid) from anon;

-- verify:
--   select proname from pg_proc where proname = 'cancel_own_reservation';  -- 1 row
