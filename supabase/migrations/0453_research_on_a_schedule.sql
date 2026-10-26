-- ── 0453 — RESEARCH ON A SCHEDULE ─────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R60 (Ryan, 2026-10-25: "research should refresh on demand and through configurable scheduled checks, with
-- change detection and alerts when material findings affect an initiative"). Paste into Supabase → SQL Editor → Run. A
-- second run changes nothing. Needs 0450.
--
-- WHAT.
--   vision_plans.research_every_days — how often a plan's market research is checked again: never (0), or every 30, 60
--   or 90 days. research_last_at — when it last ran; research_by — who set the schedule (the one told when a check finds
--   something new). A check runs when it's due and an owner or admin has the vision open — GT3 has no background job that
--   may spend on AI without someone there; a run finds only what's new (a source and claim already stored is not stored
--   again) and, when something is, raises one quiet alert to whoever set the schedule.
--   Written under the plans' existing policies (owners and admins), in the history as every plan change is.
--
-- set lock_timeout (database F16): three columns added (a constant default — no rewrite).
-- existing rows: none changed (every plan starts at "never").
-- rollback: alter table vision_plans drop column research_every_days, drop column research_last_at, drop column research_by.
-- changelog: none — the owners' own screen.

set lock_timeout = '5s';

alter table public.vision_plans add column if not exists research_every_days smallint not null default 0;
alter table public.vision_plans add column if not exists research_last_at timestamptz;
alter table public.vision_plans add column if not exists research_by uuid;
alter table public.vision_plans drop constraint if exists vision_plans_research_every;
alter table public.vision_plans add constraint vision_plans_research_every check (research_every_days in (0, 30, 60, 90));

-- verify (numbers only):
--   select count(*) from public.vision_plans where research_every_days > 0;   -- 0 (first run)
select public.record_migration('0453_research_on_a_schedule');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
