-- 0219 — Stop sales stop being invisible (Phase 3 foundation). Cup orders auto-stamp the live EVENT
-- (0024) but truck STOPS had no attribution column at all — sales made while live at a stop could
-- never appear in any per-location P&L (the audit's revenue blind spot). Adds orders.stop_id and
-- extends the existing stamp trigger: no live event → attribute to the live stop
-- (live_status.current_stop_id while is_live). Purely additive; reporting can now join it.

alter table public.orders add column if not exists stop_id uuid references public.stops(id) on delete set null;
create index if not exists orders_stop_idx on public.orders (stop_id) where stop_id is not null;

create or replace function public.stamp_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null then new.event_id := public.active_event_id(); end if;
  if new.event_id is null and new.stop_id is null then
    select current_stop_id into new.stop_id from public.live_status where id = 1 and is_live;
  end if;
  return new;
end; $$;
-- (the orders_stamp_event trigger from 0024 already points at this function — no re-create needed)

-- verify:
--   select column_name from information_schema.columns where table_name='orders' and column_name='stop_id'; -- 1 row
--   select prosrc like '%current_stop_id%' from pg_proc where proname = 'stamp_order_event';                -- true
