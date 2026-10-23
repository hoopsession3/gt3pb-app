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
