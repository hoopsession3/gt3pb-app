-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0155 · REAL fulfillment_status / payment_status COLUMNS  (Layer 1, upgrades the 0153 view)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0153 shipped public.all_orders — a VIEW that computes the unified status via CASE at read time.
-- That's a real seam: "show me all unfulfilled orders today" only worked through the view, the
-- columns weren't indexable/queryable directly, and the mapping logic lived only in the view.
--
-- This adds REAL, trigger-populated fulfillment_status + payment_status columns on all 3 order
-- tables. The original per-channel columns (orders.status, drop_orders.stage, delivery_orders
-- .status/.payment_status) stay exactly as they are and remain what every crew screen reads and
-- writes — ZERO application code changes required, zero UI rewrite risk. A BEFORE INSERT OR UPDATE
-- trigger keeps the new columns in sync automatically on every write, so crew clicking the same
-- buttons they always have silently populates the unified lens alongside. The view then becomes a
-- thin pass-through instead of duplicating the mapping logic.
--
-- drop_orders already has a granular `stage` (0148: reserved/preparing/ready/en_route/picked_up),
-- kept in sync with the legacy `picked_up` boolean by trg `sync_drop_stage_tg` (UPDATE-only, fires
-- alphabetically before this migration's `sync_pack_status_tg` on the same event — so this trigger
-- always reads the already-reconciled stage/picked_up). delivery_orders already has a real
-- `payment_status` column matching the target vocabulary (pending/paid/failed/refunded) — not
-- duplicated, just left as the source for the unified view.

-- ── orders (cup) ──────────────────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists fulfillment_status text
  check (fulfillment_status in ('placed','in_prep','ready','fulfilled','canceled'));
alter table public.orders add column if not exists payment_status text
  check (payment_status in ('pending','paid'));
create index if not exists orders_fulfillment_idx on public.orders(fulfillment_status);

create or replace function public.sync_order_status() returns trigger
language plpgsql as $$
begin
  new.fulfillment_status := case new.status
    when 'void' then 'canceled'
    when 'done' then 'fulfilled'
    when 'new'  then 'placed'
    else 'in_prep'  -- preparing / ready
  end;
  new.payment_status := case when new.paid then 'paid' else 'pending' end;
  return new;
end $$;
drop trigger if exists sync_order_status_tg on public.orders;
create trigger sync_order_status_tg before insert or update on public.orders
  for each row execute function public.sync_order_status();
-- Backfill: writes ONLY the two new columns (never touches status/paid — the columns crew UI
-- depends on), narrowly scoped to rows that don't have it yet. Idempotent.
update public.orders set
  fulfillment_status = case status when 'void' then 'canceled' when 'done' then 'fulfilled' when 'new' then 'placed' else 'in_prep' end,
  payment_status = case when paid then 'paid' else 'pending' end
  where fulfillment_status is null;

-- ── drop_orders (pickup packs) — sourced from the finer-grained `stage`, not just `picked_up` ────
alter table public.drop_orders add column if not exists fulfillment_status text
  check (fulfillment_status in ('placed','in_prep','ready','fulfilled','canceled'));
alter table public.drop_orders add column if not exists payment_status text
  check (payment_status in ('pending','paid'));
create index if not exists drop_orders_fulfillment_idx on public.drop_orders(fulfillment_status);

create or replace function public.sync_pack_status() returns trigger
language plpgsql as $$
begin
  if new.canceled_at is not null then
    new.fulfillment_status := 'canceled';
  else
    new.fulfillment_status := case new.stage
      when 'picked_up'  then 'fulfilled'
      when 'preparing'  then 'in_prep'
      when 'ready'      then 'ready'
      when 'en_route'   then 'ready'   -- assembled + moving; not yet in the customer's hands
      else 'placed'                    -- reserved
    end;
  end if;
  new.payment_status := case when new.paid then 'paid' else 'pending' end;
  return new;
end $$;
drop trigger if exists sync_pack_status_tg on public.drop_orders;
create trigger sync_pack_status_tg before insert or update on public.drop_orders
  for each row execute function public.sync_pack_status();
-- Backfill: writes ONLY the two new columns (never touches stage/picked_up/paid), scoped to rows
-- that don't have it yet. Idempotent.
update public.drop_orders set
  fulfillment_status = case
    when canceled_at is not null then 'canceled'
    else case stage
      when 'picked_up' then 'fulfilled' when 'preparing' then 'in_prep'
      when 'ready' then 'ready' when 'en_route' then 'ready' else 'placed'
    end
  end,
  payment_status = case when paid then 'paid' else 'pending' end
  where fulfillment_status is null;

-- ── delivery_orders — payment_status already matches the target vocabulary; add fulfillment only ─
alter table public.delivery_orders add column if not exists fulfillment_status text
  check (fulfillment_status in ('placed','in_prep','ready','fulfilled','canceled'));
create index if not exists delivery_orders_fulfillment_idx on public.delivery_orders(fulfillment_status);

create or replace function public.sync_delivery_status() returns trigger
language plpgsql as $$
begin
  new.fulfillment_status := case
    when new.canceled_at is not null then 'canceled'
    when new.status = 'delivered' then 'fulfilled'
    when new.status = 'received' then 'placed'
    else 'in_prep'  -- brewed / out_for_delivery / held_for_pickup / issue
  end;
  return new;
end $$;
drop trigger if exists sync_delivery_status_tg on public.delivery_orders;
create trigger sync_delivery_status_tg before insert or update on public.delivery_orders
  for each row execute function public.sync_delivery_status();
-- Backfill: writes ONLY the new column (never touches status/canceled_at), scoped to rows that
-- don't have it yet. Idempotent.
update public.delivery_orders set
  fulfillment_status = case
    when canceled_at is not null then 'canceled'
    when status = 'delivered' then 'fulfilled'
    when status = 'received' then 'placed'
    else 'in_prep'
  end
  where fulfillment_status is null;

-- ── the unified view becomes a thin pass-through — mapping logic now lives once, in the triggers ─
create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id, fulfillment_status, payment_status, total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id, fulfillment_status, payment_status, total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id, fulfillment_status, payment_status, total_cents, created_at
  from public.delivery_orders;

-- verify:
--   select fulfillment_status, count(*) from public.orders group by 1;
--   select fulfillment_status, count(*) from public.drop_orders group by 1;
--   select fulfillment_status, count(*) from public.delivery_orders group by 1;
--   select channel, fulfillment_status, count(*) from public.all_orders group by 1,2 order by 1,2;
--   select count(*) from public.orders where fulfillment_status is null;         -- 0
--   select count(*) from public.drop_orders where fulfillment_status is null;   -- 0
