-- 0007 — stop notes
-- Admin-authored event details / "what to know" for a stop, shown to customers
-- when they tap a stop on the Truck screen. Public-readable (inherits the
-- existing "public read stops" select policy); admin-writable (inherits
-- "admin write stops").
alter table public.stops add column if not exists notes text;
