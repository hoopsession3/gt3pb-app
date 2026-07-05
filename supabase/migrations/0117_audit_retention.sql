-- 0117 — audit-log retention: the append-only audit_log (0042) gains a row on every write to the
-- high-write tables (orders, subscriptions, profiles, reserves, assets, inventory_items,
-- event_approvals). Fine at launch, but on a small-tier DB it grows unbounded forever. Prune rows
-- past the retention window weekly so the table stays bounded — while keeping a FULL YEAR of trail
-- for the due-diligence story. Closes Risk Register R-003. Mirrors tidy_acked_alerts (0113).
create or replace function public.tidy_audit_log(keep_days int default 365) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- floor the window at 90 days so a bad argument can never nuke the recent trail
  delete from public.audit_log
   where at < now() - make_interval(days => greatest(keep_days, 90));
  get diagnostics n = row_count;
  return n;
end $$;

-- The audit_log is tamper-proof by design (0042: no write policy, SECURITY DEFINER trigger only).
-- This pruner is also SECURITY DEFINER, so lock execute down to the cron owner — an authenticated
-- user must never be able to call it to erase history.
revoke all on function public.tidy_audit_log(int) from public;
revoke all on function public.tidy_audit_log(int) from anon;
revoke all on function public.tidy_audit_log(int) from authenticated;

-- weekly, Monday 07:10 — just after tidy-acked-alerts. Idempotent (re-schedule is a no-op); if
-- pg_cron isn't enabled the guard swallows it so the migration still applies cleanly.
do $$ begin
  perform cron.schedule('tidy-audit-log', '10 7 * * 1', 'select public.tidy_audit_log(365)');
exception when others then null; end $$;
