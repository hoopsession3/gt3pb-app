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
-- pending-from: 0445
-- generated-at: 2026-10-23
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0445_every_change_to_what_we_sell_is_in_the_activity_log.sql
-- ============================================================
begin;   -- 0445, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0445 — EVERY CHANGE TO WHAT WE SELL IS IN THE ACTIVITY LOG ───────────────────────────────────────────────────────
-- 2026-10-23. R48 (Ryan, 2026-10-23: "audits across all consoles… 10 out of 10… no regression ever"; the console audit:
-- half of Catalog's tables kept no history — merch, plans, codes and perks, the course's lessons, modules and pillars —
-- and the drops' history went to a table no screen shows). Paste into Supabase → SQL Editor → Run. A second run changes
-- nothing.
--
-- WHY. Bulk actions arrive with this release (Catalog › merch and menu: Select, then Make live / Hide / Archive, on or off
-- the menu, sold out). A change to many rows at once is exactly the change someone asks about later — "who hid the
-- caps?" — and Settings › Activity log (components/AuditTrail, admin_audit) can only answer for a table that writes to it.
--
-- WHAT. 0260's log_admin_audit, on the tables Catalog edits that had none — every insert, update and delete, who and
-- what changed (an update that only touched a timestamp writes nothing):
--   shop_products (merch and GT3 Nutrition's price and visibility) · subscription_plans · member_benefits (codes, perks)
--   · primal_lessons · primal_modules · primal_pillars · reserves (its 0042 audit_row trigger stays as it is).
-- Each trigger is named admin_audit_<table>, so no older audit trigger is replaced.
--
-- set lock_timeout (database F16): seven triggers made.
-- existing rows: none changed.
-- changelog: none — the crew's own screen.

set lock_timeout = '5s';

do $$
declare t text;
begin
  foreach t in array array['shop_products', 'subscription_plans', 'member_benefits', 'primal_lessons', 'primal_modules', 'primal_pillars', 'reserves'] loop
    execute format('drop trigger if exists %I on public.%I', 'admin_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', 'admin_audit_' || t, t);
  end loop;
end $$;

-- verify (numbers only):
--   select count(*) from pg_trigger where tgname like 'admin_audit_%';                                             -- 7
select public.record_migration('0445_every_change_to_what_we_sell_is_in_the_activity_log');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0445
