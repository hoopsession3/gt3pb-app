-- 0129 — "86 it": a product can sell out for the day without leaving the menu. sold_out is a
-- separate axis from active (active=false = off the menu entirely; sold_out=true = on the menu,
-- marked SOLD OUT, refused by checkout server-side). Staff flip it from Menu & Products — the
-- existing "products staff write" policy (0062) already covers the column. Idempotent.
alter table public.products add column if not exists sold_out boolean not null default false;

-- Enforcement at the table, not just the API: the card path is checked in /api/checkout, but
-- pre-orders insert client-side (RLS allows paid=false). This trigger makes BOTH paths refuse a
-- sold-out or delisted item — the one source of truth the screen can't out-stale.
create or replace function public.check_order_availability() returns trigger
  language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  select string_agg(name, ' · ') into bad from public.products
   where slug = any(new.items) and (sold_out or not active);
  if bad is not null then
    raise exception '% just sold out — remove it and try again.', bad;
  end if;
  return new;
end $$;
drop trigger if exists orders_availability_check on public.orders;
create trigger orders_availability_check before insert on public.orders for each row execute function public.check_order_availability();
