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
