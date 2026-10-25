-- ── 0449 — THE MONEY, PLAN BY PLAN ─────────────────────────────────────────────────────────────────────────────────
-- 2026-10-25. R54, phase B of the investor-ready vision (Ryan, 2026-10-25: "each plan should be able to show an investor
-- how we plan to get the returns… what it costs, how it generates revenue, when it can become profitable… Conservative,
-- Base, Upside… investor payouts based on an explicitly defined investment structure"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing. Needs 0448.
--
-- WHAT.
--   vision_plan_money — one row per plan: its three scenarios' inputs (conservative, base, upside — each the uses of
--   funds, the demand, the costs; lib/visionMoney reads them) and its investment structure (a loan, a revenue share to a
--   cap, equity with a stated payout, or a SAFE). The projections are computed on the screen from these, never stored:
--   a stored number would go stale the moment an input moved.
--   The approved baseline (2026-10-25, the traceability audit — Ryan: "do not overwrite approved baseline projections
--   without explicit confirmation"; "owners only" approve): `baseline` is a snapshot of the scenarios and the structure
--   an owner approved, with when and by whom. The working numbers (`scenarios`, `structure`) are what-ifs against it;
--   only an owner may set or clear the baseline (a trigger refuses anyone else, PT403), and restoring copies it back.
--   Sensitive by nature (rent, wages, terms): owners and admins read and write it — the crew see the plan, not its money.
--   No link reads it (vision_shared is unchanged); the investor case that shows a link a plan's money is phase E, and it
--   will ask for it per link. Every change is in Settings › Activity log.
--   No draft: the numbers are Ryan's to set — nothing here is seeded.
--
-- set lock_timeout (database F16): one table made, its triggers and policies.
-- existing rows: none changed.
-- rollback: drop table vision_plan_money cascade; drop function vision_money_baseline_guard().
-- changelog: none — the owner's own screen.

set lock_timeout = '5s';

create table if not exists public.vision_plan_money (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  plan_id     uuid not null unique references public.vision_plans(id) on delete cascade,
  scenarios   jsonb not null default '{}'::jsonb check (jsonb_typeof(scenarios) = 'object' and pg_column_size(scenarios) < 200000),
  structure   jsonb not null default '{"kind":"none"}'::jsonb check (jsonb_typeof(structure) = 'object' and structure ? 'kind'
                and structure->>'kind' in ('none','loan','rev_share','equity','safe')),
  baseline    jsonb check (baseline is null or (jsonb_typeof(baseline) = 'object' and baseline ? 'scenarios' and baseline ? 'structure' and pg_column_size(baseline) < 220000)),
  baseline_at timestamptz,
  baseline_by uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Only an owner approves a baseline (or clears one). Admins work the what-ifs; the service role (tests, repair) passes.
create or replace function public.vision_money_baseline_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.baseline is not null) or (tg_op = 'UPDATE' and new.baseline is distinct from old.baseline) then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can approve a baseline.' using errcode = 'PT403';
    end if;
    if new.baseline is not null then new.baseline_at := now(); new.baseline_by := auth.uid(); else new.baseline_at := null; new.baseline_by := null; end if;
  end if;
  return new;
end $$;
revoke all on function public.vision_money_baseline_guard() from public, anon, authenticated;
drop trigger if exists vision_money_baseline_guard_tg on public.vision_plan_money;
create trigger vision_money_baseline_guard_tg before insert or update on public.vision_plan_money for each row execute function public.vision_money_baseline_guard();

drop trigger if exists stamp_tenant_tg on public.vision_plan_money;
create trigger stamp_tenant_tg before insert on public.vision_plan_money for each row execute function public.stamp_tenant();
alter table public.vision_plan_money enable row level security;
drop policy if exists "vision money admin" on public.vision_plan_money;
create policy "vision money admin" on public.vision_plan_money for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "tenant isolation" on public.vision_plan_money;
create policy "tenant isolation" on public.vision_plan_money as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.vision_plan_money from public, anon, authenticated;
grant select, insert, update, delete on public.vision_plan_money to authenticated;
drop trigger if exists admin_audit_vision_plan_money on public.vision_plan_money;
create trigger admin_audit_vision_plan_money after insert or update or delete on public.vision_plan_money for each row execute function public.log_admin_audit();

-- verify (numbers only):
--   select count(*) from public.vision_plan_money;   -- 0 (first run)
select public.record_migration('0449_the_money_plan_by_plan');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
