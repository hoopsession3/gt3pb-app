-- 0018 — track when an order's status last changed. Powers the KDS time-in-stage
-- clock and the "recently completed" tray (orders linger after pickup, reviewable).
alter table public.orders add column if not exists status_changed_at timestamptz not null default now();

create or replace function public.touch_order_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end; $$;

drop trigger if exists trg_touch_order_status on public.orders;
create trigger trg_touch_order_status before update on public.orders
  for each row execute function public.touch_order_status();
