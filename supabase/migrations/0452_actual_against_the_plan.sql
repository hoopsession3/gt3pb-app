-- ── 0452 — ACTUAL AGAINST THE PLAN ────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R58 (the financial traceability audit's gap 8: "no actual-vs-projected for a live plan"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing. Needs 0448.
--
-- WHAT.
--   vision_plans.opened_on — the day a plan opened (its month 1 starts here).
--   vision_plans.actual_channel — which of GT3's order channels records its sales (the truck's cups, pickups, delivery,
--   office, the shop), so its real months can be read from the order ledger beside the months the plan projected.
--   Both empty until an owner or admin sets them; nothing is guessed. Written under the plans' existing policies
--   (owners and admins), in the history as every plan change is. No link reads them (vision_shared is unchanged).
--
-- set lock_timeout (database F16): two columns added (nullable, no default — no rewrite).
-- existing rows: none changed.
-- rollback: alter table vision_plans drop column opened_on, drop column actual_channel.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

alter table public.vision_plans add column if not exists opened_on date;
alter table public.vision_plans add column if not exists actual_channel text;
alter table public.vision_plans drop constraint if exists vision_plans_actual_channel;
alter table public.vision_plans add constraint vision_plans_actual_channel check (actual_channel is null or actual_channel in ('cup','pickup','delivery','office','shop'));

-- verify (numbers only):
--   select count(*) from public.vision_plans where opened_on is not null;   -- 0 (first run)
select public.record_migration('0452_actual_against_the_plan');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
