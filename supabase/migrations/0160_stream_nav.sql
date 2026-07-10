-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0160 · STREAM NAV — the operator console navigates by work stream
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The bottom bar becomes a projection of work_streams (0159): Today (cross-stream command center)
-- plus the user's pinned lanes. Two additions:
--   work_streams.icon — an icon KEY the client resolves (tenant lanes pick from the icon set)
--   profiles.nav_pins — per-user pinned lane keys, ordered; null = role-based default

alter table public.work_streams add column if not exists icon text;
update public.work_streams set icon = key where icon is null
  and key in ('service', 'events', 'production', 'brand', 'business');

alter table public.profiles add column if not exists nav_pins text[];

-- verify:
--   select key, icon from public.work_streams order by sort;                       -- 5 rows, icon = key
--   select count(*) from information_schema.columns
--     where table_name = 'profiles' and column_name = 'nav_pins';                  -- 1
