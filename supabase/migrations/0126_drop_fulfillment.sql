-- 0126 — drop fulfillment + planning wiring. Two relational touches:
-- 1) Reservations become manageable: a canceled reservation keeps its row (auditable, excluded
--    from the brew sheet / revenue) instead of being deleted.
-- 2) Brew batches gain a drop_date, so batches queued FOR a Saturday drop are first-class rows in
--    the existing brew system (windows, timers, status ladder) — the drop sheet and the brew
--    planner read the same relation. Drops are keyed by their natural key (the Saturday date),
--    matching drop_orders.drop_date.
alter table public.drop_orders add column if not exists canceled_at timestamptz;
alter table public.brew_batches add column if not exists drop_date date;
create index if not exists brew_batches_drop_idx on public.brew_batches(drop_date) where drop_date is not null;
