-- 0171 — one canonical Cart value: normalize rig 'cart' → 'cart_only', then close the door.
-- 3c47a2e consolidated the menu & rig editors into MenuRigChips, which writes only the canonical
-- rig values ('cart_only' | 'trailer_only' | 'trailer_plus_cart'). Rows written by the old
-- prep-hub editor may still hold 'cart' — 0110 had to widen events_rig_check to accept it.
-- Normalize the data first, then re-tighten the CHECK so 'cart' can never come back.
-- stops.rig stays free text (0095 convention) — its rows are normalized here too, no constraint.
update public.events set rig = 'cart_only' where rig = 'cart';
update public.stops  set rig = 'cart_only' where rig = 'cart';

alter table public.events drop constraint if exists events_rig_check;
alter table public.events add constraint events_rig_check
  check (rig in ('cart_only', 'trailer_only', 'trailer_plus_cart') or rig is null);

-- verify:
--   select count(*) from public.events where rig = 'cart';                                  -- 0
--   select count(*) from public.stops  where rig = 'cart';                                  -- 0
--   select count(*) from pg_constraint where conname = 'events_rig_check';                  -- 1
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'events_rig_check'; -- lists only the 3 canonical values
