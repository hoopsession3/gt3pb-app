-- 0005 — persisted orders + order items + a fulfillment queue
-- Paste into Supabase → SQL Editor → Run. Idempotent.
-- Orders are written server-side (the /api/checkout route, service-role) via record_order,
-- so a client can never forge a total. Members read their own orders; admins read/work all.

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,  -- null for anonymous pre-orders
  stop_id           uuid references public.stops(id),
  status            text not null default 'pending' check (status in ('pending','ready','picked_up','cancelled')),
  total_cents       int  not null,
  paid              boolean not null default false,
  square_payment_id text,
  note              text,
  created_at        timestamptz not null default now(),
  ready_at          timestamptz
);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  drink_id   text not null,
  name       text,
  qty        int  not null check (qty > 0),
  unit_cents int  not null
);

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- ───────────────────────── realtime (truck sees orders arrive instantly) ─────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "own orders read"   on public.orders;
create policy "own orders read"   on public.orders for select using (auth.uid() = user_id);
drop policy if exists "admin read orders"  on public.orders;
create policy "admin read orders"  on public.orders for select using (public.is_admin());
drop policy if exists "admin write orders" on public.orders;
create policy "admin write orders" on public.orders for update using (public.is_admin()) with check (public.is_admin());

-- order_items visible whenever the parent order is visible to the caller
drop policy if exists "order items read" on public.order_items;
create policy "order items read" on public.order_items for select using (
  exists (select 1 from public.orders o
          where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
);

-- ───────────────────────── record_order RPC (server-side writer) ─────────────────────────
-- SECURITY DEFINER so the service-role route can insert order + items atomically. Phase 2 will
-- extend this to award loyalty points in the same transaction.
create or replace function public.record_order(
  p_user       uuid,
  p_stop       uuid,
  p_total_cents int,
  p_paid       boolean,
  p_payment_id text,
  p_items      jsonb            -- [{ "id","name","qty","unit_cents" }, …]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  oid uuid;
  it  jsonb;
begin
  insert into public.orders (user_id, stop_id, total_cents, paid, square_payment_id)
  values (p_user, p_stop, p_total_cents, coalesce(p_paid, false), p_payment_id)
  returning id into oid;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, drink_id, name, qty, unit_cents)
    values (oid, it->>'id', it->>'name', (it->>'qty')::int, (it->>'unit_cents')::int);
  end loop;

  return oid;
end; $$;

grant execute on function public.record_order(uuid, uuid, int, boolean, text, jsonb) to service_role;
