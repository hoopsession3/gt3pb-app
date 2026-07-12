-- 0189 — make office delivery pricing owner-editable (was hardcoded in lib/office.ts). Two knobs on
-- the live_status singleton (id=1), edited from the crew Settings tab; the office order flow reads
-- them live, falling back to the code constants ($45/gal, 3 gal) if unset.
alter table public.live_status add column if not exists office_price_cents int not null default 4500;
alter table public.live_status add column if not exists office_min_gallons int not null default 3;

-- verify:
-- select office_price_cents, office_min_gallons from public.live_status where id = 1;  -- 4500, 3
