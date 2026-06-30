-- 0110 — add a "trailer only" rig option (trailer without the cart) for event + stop planning.
-- events.rig had a CHECK limiting it to cart_only/trailer_plus_cart; widen it to also accept
-- 'trailer_only' (and 'cart', which the shared Menu & rig editor already writes). stops.rig is
-- free text, so the new option just needs the UI. The load-out space math keys off "trailer" in the
-- value, so trailer_only routes to the trailer box automatically.
alter table public.events drop constraint if exists events_rig_check;
alter table public.events add constraint events_rig_check
  check (rig in ('cart', 'cart_only', 'trailer_only', 'trailer_plus_cart') or rig is null);
