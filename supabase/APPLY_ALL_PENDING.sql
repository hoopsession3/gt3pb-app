-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0380
-- generated-at: 2026-10-11
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0380_the_escalation_finds_the_alert_push_by_what_it_calls.sql
-- ============================================================
-- ── 0380 — THE ESCALATION FINDS THE ALERT PUSH BY WHAT IT CALLS, NOT BY ITS NAME ──────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts). Found by the check run right after 0373 was applied to production.
--
-- WHY. 0373 makes its escalation trigger from 0157's fan-out — the trigger that hands every new alert to the push
-- function — and it finds that trigger by NAME: alerts_push_fanout. Production's fan-out was made as a Database Webhook
-- in the Supabase dashboard and is called push_alerts_insert. So 0373 found nothing, said so in a notice the SQL editor
-- does not show, and made no trigger, while its cron job runs every minute: a critical nobody picks up is marked
-- escalated at ten minutes and, with no door, nothing is sent — and a marked critical is never marked again.
-- Measured on production after the apply (2026-10-11, names only): public.alerts carries alerts_fold_repeats,
-- push_alerts_insert and stamp_tenant_tg, and no alerts_push_escalation.
--
-- WHAT. The door is the trigger that hands a NEW alert to supabase_functions.http_request, whatever it is called
-- (0157's name first, where both exist). The escalation trigger is made from its call, exactly as 0373 meant to: the
-- same function with the same arguments, read from the database, so this file carries no address and no key.
-- And the criticals marked while there was no door are unmarked — still unacknowledged, marked since 0373 was recorded,
-- raised in the last twelve hours (0373's window) — so the next minute's run sends each of them once. Only when THIS
-- file is the one that makes the trigger: where 0373 made it (every database built from the migrations), the criticals
-- it marked were already sent, and unmarking them would send them twice.
--
-- A second run changes nothing: the trigger is remade the same, and nothing is unmarked.
-- changelog: none — 0373's entry ("A critical nobody picks up rings the owners again") becomes true on production.

do $$
declare
  v_had   boolean;
  v_name  text;
  v_def   text;
  v_call  text;
  v_since timestamptz;
  v_n     int := 0;
begin
  select exists (select 1 from pg_trigger
                  where tgrelid = 'public.alerts'::regclass and tgname = 'alerts_push_escalation' and not tgisinternal)
    into v_had;

  select t.tgname, pg_get_triggerdef(t.oid)
    into v_name, v_def
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace s on s.oid = p.pronamespace
   where t.tgrelid = 'public.alerts'::regclass
     and not t.tgisinternal
     and s.nspname = 'supabase_functions' and p.proname = 'http_request'
     and (t.tgtype & 4) = 4                              -- it fires on INSERT
     and t.tgname <> 'alerts_push_escalation'
   order by (t.tgname = 'alerts_push_fanout') desc, t.tgname
   limit 1;

  v_call := substring(coalesce(v_def, '') from 'EXECUTE (?:FUNCTION|PROCEDURE) .*$');
  if v_call is null then
    raise notice '0380: nothing on public.alerts hands a new alert to supabase_functions.http_request, so an escalation has no way to the push function — none made.';
    return;
  end if;

  execute 'drop trigger if exists alerts_push_escalation on public.alerts';
  execute 'create trigger alerts_push_escalation after update of escalated_at on public.alerts for each row '
       || 'when (old.escalated_at is null and new.escalated_at is not null and new.severity = ''critical'' '
       || 'and new.ack_at is null and new.kind is distinct from ''device_test'') '
       || v_call;

  if not v_had then
    select applied_at into v_since
      from public.schema_migrations
     where version = '0373_a_critical_nobody_picks_up_rings_the_owners_again';
    if v_since is not null then
      update public.alerts
         set escalated_at = null
       where severity = 'critical'
         and ack_at is null
         and escalated_at >= v_since
         and created_at > now() - interval '12 hours'
         and kind is distinct from 'device_test';
      get diagnostics v_n = row_count;
    end if;
    raise notice '0380: the escalation goes through %, as every new alert does; % critical(s) marked while there was no door will be sent on the next run.', v_name, v_n;
  else
    raise notice '0380: the escalation goes through % (remade; nothing unmarked).', v_name;
  end if;
end $$;

-- verify:
--   select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname = 'alerts_push_escalation';  -- one row
--   select count(*) from public.alerts where severity = 'critical' and escalated_at > now() - interval '1 day';
select public.record_migration('0380_the_escalation_finds_the_alert_push_by_what_it_calls');
