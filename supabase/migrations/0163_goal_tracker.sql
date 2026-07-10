-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0163 · TRUE GOAL TRACKER — initiatives, lane roll-up, and data-bound metrics
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Three upgrades to goals (0142):
--   1. stream_key — every goal rolls up to a work stream (lane → owner → company). Existing goals
--      default to 'business'; leadership re-files them from the card.
--   2. metric_source — a goal can bind to a LIVE number (bottles/revenue/events/customers computed
--      from real orders) instead of manual logging. The number can't drift from reality.
--   3. goal_initiatives — the breakdown: the concrete moves that accomplish a goal, checkable,
--      each attributable. Progress = the metric bar AND initiatives done.

alter table public.goals add column if not exists stream_key text;
alter table public.goals add column if not exists metric_source text;
update public.goals set stream_key = 'business' where stream_key is null;

create table if not exists public.goal_initiatives (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  goal_id       uuid not null references public.goals(id) on delete cascade,
  title         text not null,
  done          boolean not null default false,
  owner_user_id uuid references public.profiles(id) on delete set null,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists goal_initiatives_goal_idx on public.goal_initiatives(goal_id);

alter table public.goal_initiatives enable row level security;
drop policy if exists "goal_initiatives staff read" on public.goal_initiatives;
create policy "goal_initiatives staff read" on public.goal_initiatives
  for select using ((select public.is_staff()));
-- same leadership predicate as goals (owners AND managers work the board)
drop policy if exists "goal_initiatives leadership write" on public.goal_initiatives;
create policy "goal_initiatives leadership write" on public.goal_initiatives
  for all using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  ) with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  );

drop trigger if exists stamp_tenant_tg on public.goal_initiatives;
create trigger stamp_tenant_tg before insert on public.goal_initiatives for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.goal_initiatives;
create policy "tenant isolation" on public.goal_initiatives as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- verify:
--   select count(*) from public.goals where stream_key is null;                          -- 0
--   select count(*) from pg_policies where tablename = 'goal_initiatives';               -- 3
