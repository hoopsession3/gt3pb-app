-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0161 · LANE PAGES — features move to their rightful work streams
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Dedicated pages per lane so mega-sections stop hoarding: Brew + Garage leave Plan/Prep for
-- Production; Goals joins Business; Service gains the Drive page (driver dashboard). Guarded so a
-- tenant's customized lanes are never clobbered — each update only fires if the page isn't there.

update public.work_streams set sections = array_append(sections, 'driver')
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'service' and not ('driver' = any(sections));

update public.work_streams set sections = '{brew,garage}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'production' and sections = '{plan}';

update public.work_streams set sections = array_append(sections, 'goals')
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'business' and not ('goals' = any(sections));

-- verify:
--   select key, sections from public.work_streams order by sort;
--   -- service {now,prep,driver} · events {plan,prep} · production {brew,garage} ·
--   -- brand {studio} · business {money,customers,team,goals}
