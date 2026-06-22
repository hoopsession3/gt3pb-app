-- 0033_stop_vendor.sql
-- Vendor / location management on truck stops: a point of contact, dates of
-- service, and archive (file a venue out of the active list without deleting the
-- record). Mirrors the event-archive pattern (0032).
alter table public.stops
  add column if not exists poc_name      text,
  add column if not exists poc_phone     text,
  add column if not exists poc_email     text,
  add column if not exists service_dates text,
  add column if not exists archived_at   timestamptz;

-- fast lookup of the active (non-archived) locations the operator works
create index if not exists stops_active_idx on public.stops (archived_at) where archived_at is null;
