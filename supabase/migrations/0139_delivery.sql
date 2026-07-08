-- 0139 — SUNDAY DELIVERY (Phase 1, direct channel). Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The delivery debrief's data model, built on the house rules: tenant_id on every table (0134's
-- trigger + restrictive policy attach on re-run), no client inserts on money tables (orders are
-- recorded by the charge route with the service role AFTER payment — same as cup orders), owner
-- self-service through a definer RPC (same shape as cancel_own_reservation, 0136).
-- Phase-2-proofed: channel + window are data, not hardcode; refill tier is direct-channel-only
-- (enforced in lib/delivery + the charge route; the row just records what was sold).

create table if not exists public.delivery_orders (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id              uuid references auth.users(id),
  channel              text not null default 'direct' check (channel in ('direct','uber_eats','doordash','instacart')),
  delivery_date        date not null,
  delivery_window      text not null default '5–8 AM',
  name                 text not null,
  phone                text,
  address_street       text not null,
  address_city         text not null,
  address_zip          text not null,
  access_instructions  text,
  pack_size            int  not null check (pack_size in (12, 24, 36)),
  rise_count           int  not null default 0 check (rise_count >= 0),
  flow_count           int  not null default 0 check (flow_count >= 0),
  dusk_count           int  not null default 0 check (dusk_count >= 0),
  performance_count    int  not null default 0 check (performance_count >= 0),
  performance_mix      jsonb not null default '{}'::jsonb,  -- {"rise|mct_oil": 2, "flow|grass_fed_butter": 1}
  refill_count         int  not null default 0 check (refill_count >= 0),
  new_count            int  not null default 0 check (new_count >= 0),
  bottle_subtotal_cents int not null,
  delivery_fee_cents   int  not null,
  tax_cents            int  not null default 0,
  total_cents          int  not null,
  empty_ack_at         timestamptz,          -- the required checkbox timestamp (refill orders only)
  payment_method       text not null default 'square',
  payment_status       text not null default 'paid' check (payment_status in ('pending','paid','failed','refunded')),
  status               text not null default 'received' check (status in ('received','brewed','out_for_delivery','delivered','held_for_pickup','issue')),
  driver_outcome       text check (driver_outcome in ('swap_completed','delivered_fresh_no_empties','held_no_empties')),
  empties_expected     int  not null default 0,
  empties_collected    int,                  -- actual count logged by the driver (discrepancy source)
  driver_note          text,
  canceled_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint delivery_counts_sum check (rise_count + flow_count + dusk_count + performance_count = pack_size),
  constraint delivery_refill_bound check (refill_count <= pack_size - performance_count),
  constraint delivery_refill_ack check (refill_count = 0 or empty_ack_at is not null)
);

create index if not exists delivery_orders_date_idx on public.delivery_orders(delivery_date, status);
create index if not exists delivery_orders_user_idx on public.delivery_orders(user_id);

alter table public.delivery_orders enable row level security;

-- Customers read their own; staff read all; staff update ops fields. No client INSERT policy on
-- purpose: the charge route records paid orders with the service role — fails closed.
drop policy if exists "delivery own read" on public.delivery_orders;
create policy "delivery own read" on public.delivery_orders
  for select using (user_id = (select auth.uid()));
drop policy if exists "delivery staff read" on public.delivery_orders;
create policy "delivery staff read" on public.delivery_orders
  for select using ((select public.is_staff()));
drop policy if exists "delivery staff update" on public.delivery_orders;
create policy "delivery staff update" on public.delivery_orders
  for update using ((select public.is_staff())) with check ((select public.is_staff()));

-- Owner cancels their own order while it's still 'received' AND before the Friday 6 PM ET cutoff
-- for its delivery date. A PAID cancel raises the refund alert into the crew inbox (0136 pattern).
create or replace function public.cancel_own_delivery(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.delivery_orders%rowtype;
declare cutoff timestamptz;
begin
  select * into r from public.delivery_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.status <> 'received' then return false; end if;
  cutoff := ((r.delivery_date - interval '2 days') + time '18:00') at time zone 'America/New_York';
  if now() >= cutoff then return false; end if;
  update public.delivery_orders set canceled_at = now() where id = p_id;
  if r.payment_status = 'paid' then
    insert into public.alerts (severity, category, title, body, link) values (
      'important', 'money', 'Delivery canceled — refund needed',
      r.name || ' · ' || r.pack_size || ' bottles · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.delivery_date, 'Dy Mon DD') || '. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;
grant execute on function public.cancel_own_delivery(uuid) to authenticated;
revoke execute on function public.cancel_own_delivery(uuid) from anon;

-- Out-of-zone interest — capture only; no client access (the API route inserts with service role).
create table if not exists public.delivery_waitlist (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  zip        text not null,
  email      text not null,
  created_at timestamptz not null default now(),
  unique (zip, email)
);
alter table public.delivery_waitlist enable row level security;
drop policy if exists "waitlist staff read" on public.delivery_waitlist;
create policy "waitlist staff read" on public.delivery_waitlist
  for select using ((select public.is_staff()));

-- verify:
--   select to_regclass('public.delivery_orders'), to_regclass('public.delivery_waitlist');  -- both non-null
--   select proname from pg_proc where proname = 'cancel_own_delivery';                      -- 1 row
--   select count(*) from pg_policy where polrelid = 'public.delivery_orders'::regclass;     -- >= 3 (+ tenant isolation after 0134 re-run)
