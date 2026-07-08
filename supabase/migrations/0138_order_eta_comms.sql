-- 0138 — ORDER ETA COMMS ("I'm on the way / I'm outside / running late"). Paste into Supabase →
-- SQL Editor → Run. Idempotent.
--
-- Closes the loop the other direction: the pass talks to the customer (status), now the customer
-- talks to the pass. One field, a fixed vocabulary, written only through a definer RPC by the
-- order's owner while the order is active. The KDS renders it live (orders is already realtime):
-- OUTSIDE rings the pass so the crew calls their name.
alter table public.orders add column if not exists eta_status text
  check (eta_status in ('on_way', 'outside', 'late'));
alter table public.orders add column if not exists eta_at timestamptz;

create or replace function public.set_order_eta(p_order uuid, p_eta text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.orders%rowtype;
begin
  if p_eta is not null and p_eta not in ('on_way', 'outside', 'late') then return false; end if;
  select * into r from public.orders
    where id = p_order and user_id = (select auth.uid()) for update;
  -- owner only, active orders only (done/void orders are history — nothing to signal)
  if r.id is null or r.status not in ('new', 'preparing', 'ready') then return false; end if;
  update public.orders set eta_status = p_eta, eta_at = case when p_eta is null then null else now() end
    where id = p_order;
  return true;
end $$;

grant execute on function public.set_order_eta(uuid, text) to authenticated;
revoke execute on function public.set_order_eta(uuid, text) from anon;

-- verify:
--   select proname from pg_proc where proname = 'set_order_eta';  -- 1 row
