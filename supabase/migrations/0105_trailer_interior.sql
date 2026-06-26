-- 0105 — trailer INTERIOR space, so the load-out understands volume (does it fit?), not just weight.
-- 0037 carried the cert-plate weight numbers (GVWR / cargo lb / tongue); this adds the packable box:
-- interior length × width × height (inches) and a usable% that discounts the built-in rig + an aisle.
-- Seeded to the GT3 Diamond Cargo 6x12 SA interior (≈144 × 68 × 70 in); owner can tune in the UI.

alter table public.trailer_profile add column if not exists interior_len_in    numeric;
alter table public.trailer_profile add column if not exists interior_width_in  numeric;
alter table public.trailer_profile add column if not exists interior_height_in numeric;
alter table public.trailer_profile add column if not exists usable_pct         numeric default 60;  -- % of the box actually packable around the rig

-- the tow/cart-only vehicle's cargo bay (the Honda) — cart-only stops load here, not the trailer
alter table public.trailer_profile add column if not exists veh_cargo_len_in    numeric;
alter table public.trailer_profile add column if not exists veh_cargo_width_in  numeric;
alter table public.trailer_profile add column if not exists veh_cargo_height_in numeric;
alter table public.trailer_profile add column if not exists veh_usable_pct      numeric default 70;

update public.trailer_profile set
  interior_len_in    = coalesce(interior_len_in, 144),
  interior_width_in  = coalesce(interior_width_in, 68),
  interior_height_in = coalesce(interior_height_in, 70),
  usable_pct         = coalesce(usable_pct, 60),
  -- seats-down midsize SUV cargo bay (~Honda Pilot): tune to the real tape measurements
  veh_cargo_len_in    = coalesce(veh_cargo_len_in, 84),
  veh_cargo_width_in  = coalesce(veh_cargo_width_in, 50),
  veh_cargo_height_in = coalesce(veh_cargo_height_in, 34),
  veh_usable_pct      = coalesce(veh_usable_pct, 70)
where id = 1;
