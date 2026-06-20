-- 0010 — stop street address (admin geocodes it → lat/lng for accurate directions)
alter table public.stops add column if not exists address text;
alter table public.stops drop constraint if exists stop_address_len;
alter table public.stops add constraint stop_address_len check (char_length(coalesce(address, '')) <= 300);
