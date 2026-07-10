-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0168 · DEAL LINES — every deal declares its line of business
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The catalog covers ALL engagement types the truck actually sells (the standard "line of
-- business" dimension): truck-stop placements, private events, wholesale, retail placement,
-- standing service, other. Opportunities inherit the line from their attached deal; the pipeline
-- board filters by it; a won deal's line is the future handoff signal (event line → book the
-- event, truck_stop line → add the stop, wholesale → recurring delivery).

alter table public.deals add column if not exists line text not null default 'other';
alter table public.deals drop constraint if exists deals_line_check;
alter table public.deals add constraint deals_line_check
  check (line in ('truck_stop','private_event','wholesale','retail','standing','other'));

-- verify:
--   select count(*) from information_schema.columns where table_name = 'deals' and column_name = 'line';  -- 1
