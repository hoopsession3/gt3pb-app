-- 0243 — Readiness (prep) has sat in both the Service and Events lanes since 0159/0165/0167. Every
-- component it mounts reads the same unfiltered data regardless of which lane you tapped it from
-- (confirmed by reading the render tree — no lane-scoped query anywhere under it), and its own
-- on-screen copy says "All open prep · one board." So it was never actually two different views —
-- one screen occupying two tab slots, which is what made "why is prep on the screen twice" and "is
-- this managed here or there" the very first things flagged in this round's crew-console audit.
--
-- Dropping it from 'events' rather than 'service': Service is one of the 4 default-pinned lanes
-- (Today/Service/Brand/Business); Events lives behind "More" unless someone pins it. Readiness
-- stays reachable exactly where it already gets tapped from day to day; Events keeps Plan on its
-- own (matches Pipeline's own history of moving in and out of this lane per 0165/0167 — a lane
-- shrinking to one section isn't new here).
--
-- Idempotent: the guard on the CURRENT sections value makes this a no-op if it's already been
-- changed by hand or a later migration got here first.
update public.work_streams set sections = '{plan}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'events' and sections = '{plan,prep}';

-- verify:
--   select sections from public.work_streams where key = 'events';   -- {plan}
--   select sections from public.work_streams where key = 'service';  -- unchanged: {now,prep,stops,driver}
