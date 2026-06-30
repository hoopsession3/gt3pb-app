-- 0113 — manual feed order for the Studio grid, so the team can arrange the Instagram feed
-- aesthetic (drag tiles) independent of schedule. Lower = earlier (top-left). Null falls back to
-- date order.
alter table public.content_items add column if not exists grid_sort int;
