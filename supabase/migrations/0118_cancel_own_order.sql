-- 0118 — customer self-service order cancel. Closes the biggest order-UX gap: a member could not
-- cancel their own order at all (orders RLS is insert + read-own, no update). This adds a tightly
-- guarded RPC so a member can cancel their OWN order, but ONLY while it's still 'new' — the moment
-- the crew advances it to 'preparing' the window closes, so a drink already being made can't be
-- pulled out from under the pass. Runs as SECURITY DEFINER (the orders update policy is admin-only),
-- with auth.uid() still scoping it to the caller's own row.
create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order and user_id = auth.uid();
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void

  update public.orders set status = 'void' where id = p_order;

  -- A card-paid order that's canceled needs a refund in Square — flag the crew (best-effort inbox
  -- row; the app's push dispatcher fans it out). The refund itself is done in Square.
  if o.paid then
    insert into public.alerts (severity, category, title, body, link)
    values ('important', 'money',
            'Customer canceled a paid order — refund needed',
            'A member canceled order #' || upper(substr(o.id::text, 1, 4)) ||
            ' ($' || to_char((o.total_cents / 100.0)::numeric, 'FM999990.00') || '). Refund it in Square.',
            '/admin');
  end if;
  return true;
end $$;

-- Only signed-in members can call it; the function itself enforces owner + 'new' status.
revoke all on function public.cancel_own_order(uuid) from public, anon;
grant execute on function public.cancel_own_order(uuid) to authenticated;
