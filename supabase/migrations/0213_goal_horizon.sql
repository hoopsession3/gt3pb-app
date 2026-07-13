-- 0213 — Planning horizon on goals: classify each objective as strategic / tactical / operational
-- (the standard enterprise-planning hierarchy) so the team can see the plan at altitude — a few big
-- strategic bets, the tactical moves under them, the operational day-to-day. Drives the planning
-- board. Idempotent + additive.

alter table public.goals add column if not exists horizon text not null default 'tactical';
alter table public.goals drop constraint if exists goals_horizon_check;
alter table public.goals add constraint goals_horizon_check check (horizon in ('strategic','tactical','operational'));
grant update(horizon) on public.goals to authenticated;

-- verify:
--   select column_name from information_schema.columns where table_name='goals' and column_name='horizon'; -- 1 row
