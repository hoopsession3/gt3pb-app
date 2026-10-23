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
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0446
-- generated-at: 2026-10-23
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0446_every_list_the_console_edits_keeps_its_history.sql
-- ============================================================
begin;   -- 0446, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0446 — EVERY LIST THE CONSOLE EDITS KEEPS ITS HISTORY ────────────────────────────────────────────────────────────
-- 2026-10-23. R49 (Ryan, 2026-10-23: "audits across all consoles… 10 out of 10… no regression ever"; the console audit,
-- scripts/console.audit.mjs, point 8 — every table a list edits says who changed what, on Settings › Activity log).
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. Settings › Activity log now reads both trails (components/AuditTrail, R49): 0260's admin_audit (the catalog, roles,
-- budgets, copy) and 0042's audit_log (orders, reserves, inventory, gear, offer letters, agreements…), which no screen
-- showed until now. Nine tables the console's lists edit kept neither: an invoice marked paid, a broadcast taken down,
-- a prep task done, an event or stop moved, a shoot planned, an office order changed, a to-do ticked — and nobody could
-- say who, or when.
--
-- WHAT. 0042's audit_row on each (insert, update, delete — the row before and after, the account that did it), kept a
-- year and pruned weekly as the rest of audit_log is (0117's tidy_audit_log):
--   invoices · broadcasts · event_tasks · events · stops · shoots · shots · business_orders · todos.
-- Each trigger is named audit_<table>, as 0042's are — none of the nine had one.
--
-- NOT HERE, ON PURPOSE: customers and vip_verifications. Their rows are a person — a name, an email, a phone, a photo of
-- a bottle — and a year of copies in audit_log is a year of copies account erasure (0353) would have to find; with
-- customers under the trigger, an erased account's name and phone were left in audit_log (scripts/db.erasure.test, R49).
-- Their changes keep the trails they had (0392's tier line in admin_audit).
--
-- set lock_timeout (database F16): nine triggers made.
-- existing rows: none changed.
-- changelog: none — the crew's own screen.

set lock_timeout = '5s';

do $$
declare t text;
begin
  foreach t in array array['invoices', 'broadcasts', 'event_tasks', 'events', 'stops', 'shoots', 'shots', 'business_orders', 'todos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', 'audit_' || t, t);
    end if;
  end loop;
end $$;

-- verify (numbers only):
--   select count(*) from pg_trigger where tgname in ('audit_invoices','audit_broadcasts','audit_event_tasks','audit_events',
--     'audit_stops','audit_shoots','audit_shots','audit_business_orders','audit_todos');                                -- 9
select public.record_migration('0446_every_list_the_console_edits_keeps_its_history');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0446
