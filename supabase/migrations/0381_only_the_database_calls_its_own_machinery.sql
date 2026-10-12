-- ── 0381 — ONLY THE DATABASE CALLS ITS OWN MACHINERY ──────────────────────────────────────────────────────────────
-- 2026-10-11. Found by the first security snapshot of production (scripts/security.snapshot.sql, read once with the
-- owner's yes; supabase/schema.security.json at ledger 0380): 162 SECURITY DEFINER functions the API roles may call.
--
-- WHY. A SECURITY DEFINER function runs as its owner, past every row-level policy, and Postgres lets PUBLIC execute every
-- new function — so anon and authenticated can call each one as an RPC, with the anon key the app ships to every phone.
-- Most of the 162 check who is calling (is_staff(), auth.uid(), a raise) or are trigger functions nobody can call.
-- These did not check, and did not need to be callable at all:
--   · credit_wallet, claw_wallet — the loyalty ledger's writers. Anyone holding the public key could award any account any
--     number of points (a made-up order id each time), trip the $5 referral credit for both sides, or claw back another
--     customer's points. Only the award_points triggers call them, and those run as the owner.
--   · eleven pg_cron jobs. tidy_acked_alerts(keep_days) deletes acknowledged alerts, purge_webhook_events empties the
--     webhook inbox, release_expired_holds frees reserve holds, archive_stale_stops archives stops, the rest raise alerts
--     and nudges on demand. pg_cron runs them as the database's own role.
--   · active_event_id, catalog_cogs_pct, prune_client_errors — helpers only other definer functions call.
--   · resolve_customer, bump_client_error, progress_kpis, office_next_delivery — the server calls these with the service
--     role (app/api/*/checkout, reserve, subscriptions, errors, architecture/stats, office); nobody else should.
--     resolve_customer finds or makes a customer record from a phone number or an email.
--   · every SECURITY DEFINER trigger function: not callable, but granted and counted. Revoking changes nothing that runs:
--     Postgres checks EXECUTE on a trigger's function when the trigger is created, never when it fires.
-- Two the crew's own screens call as the person answered anyone who asked: funnel_counts (any signed-in account) and
-- stale_content_count (anyone). They now count for the crew only, and answer nothing to anyone else.
--
-- HOW IT STAYED OPEN. Several of these were closed on purpose — 0229 revoked credit_wallet and claw_wallet "from anon,
-- authenticated", as 0133, 0151 and 0216 did for bump_client_error and resolve_customer — and the door never shut: Postgres
-- grants every new function to PUBLIC, anon and authenticated are members of PUBLIC, and a revoke that does not name
-- public leaves that grant standing. The same half-revoke left anon able to call three functions that are the signed-in
-- person's own (cancel_own_reservation, cancel_own_delivery, set_order_eta: 0136, 0138, 0139, 0242, 0341); each checks the
-- order is the caller's, so anon got nothing from them, and they now keep authenticated alone, as written.
-- scripts/drift.check.mjs's REVOKE GATE fails any migration from this one on that repeats the half-revoke.
--
-- WHAT. EXECUTE is taken from PUBLIC, anon and authenticated on each function above — by name, every overload — and given
-- to service_role by name, so the server, pg_cron and the triggers go on exactly as before. Untouched: the functions row-
-- level policies call (is_staff, effective_tenant, …, which must stay callable by the person the policy judges), the ones
-- people call for themselves (each checks who is calling), and views' helpers (market_brew_capacity, resolve_ingredient).
-- A second run changes nothing.
-- changelog: none — nothing anyone does in the app changes; the doors closed were never the app's.

do $$
declare
  f regprocedure;
  n int := 0;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and p.prosecdef
       and (p.prorettype = 'trigger'::regtype
            or p.proname = any (array[
                 'credit_wallet', 'claw_wallet',
                 'alert_autoexpire', 'archive_stale_stops', 'brew_due_alerts', 'founder_digest_alert',
                 'goal_checkin_nudges', 'os_audit_nudge', 'purge_webhook_events', 'release_expired_holds',
                 'stop_recap_alerts', 'task_due_alerts', 'tidy_acked_alerts',
                 'active_event_id', 'catalog_cogs_pct', 'prune_client_errors',
                 'resolve_customer', 'bump_client_error', 'progress_kpis', 'office_next_delivery']))
     order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    n := n + 1;
  end loop;
  raise notice '0381: % function(s) closed to the API roles and kept for the service role.', n;
end $$;

-- The signed-in person's own three: closed to anon (through PUBLIC), kept for authenticated, as their migrations meant.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and p.proname = any (array['cancel_own_reservation', 'cancel_own_delivery', 'set_order_eta'])
     order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- The crew's funnel report: the same count, for the crew only (0199 said "staff-gated" and gated nothing).
create or replace function public.funnel_counts(p_days int default 14)
returns table(funnel text, step text, n bigint)
language sql stable security definer set search_path = public as $$
  select funnel, step, count(*)::bigint
  from public.funnel_events
  where at >= now() - make_interval(days => greatest(1, least(p_days, 120)))
    and tenant_id = public.effective_tenant()
    and public.is_staff()
  group by funnel, step;
$$;

-- The calendar's "review" nudge: the count for the crew, nothing for anyone else.
create or replace function public.stale_content_count() returns int
  language sql security definer stable set search_path = public as $$
  select case when public.is_staff() then
    (select count(*)::int from public.content_items
      where archived_at is null and status <> 'published'
        and scheduled_for is not null and scheduled_for < now())
  else 0 end;
$$;
revoke execute on function public.stale_content_count() from public, anon;
grant execute on function public.stale_content_count() to authenticated, service_role;

-- verify:
--   select has_function_privilege('anon', 'public.credit_wallet(uuid,int,int,uuid,text)', 'execute');          -- f
--   select has_function_privilege('authenticated', 'public.tidy_acked_alerts(int)', 'execute');                -- f
--   select has_function_privilege('service_role', 'public.resolve_customer(uuid,text,text,text)', 'execute');   -- t
--   select has_function_privilege('anon', 'public.is_staff()', 'execute');                                     -- t (policies)
select public.record_migration('0381_only_the_database_calls_its_own_machinery');
