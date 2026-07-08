-- 0141 — CUSTOMER RECORDS: COMPLETE AND NEVER LOST. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Two guarantees, enforced by the database itself (not by convention):
--   COMPLETE — every insert/update/delete on a customer table lands in audit_log with the full
--   old+new row (0042's audit_row). A blanked phone number or an overwritten address is always
--   recoverable. This migration catches the audit up to the tables added since 0042.
--   NEVER LOST — hard DELETE is blocked on customer-record tables for EVERY role: client (RLS
--   already had no delete policies), service-role (bypasses RLS but not triggers), and the SQL
--   console. The app's soft-delete convention (canceled_at / archived_at / status) is now law.
--
-- Deliberate maintenance (e.g. a legal erasure request) uses the hatch, same session:
--   select set_config('gt3.allow_hard_delete','on',false);  -- then the delete, then it expires
-- Note: deleting an auth.users row cascades into profiles and will be blocked the same way —
-- set the hatch first. That is intentional: no path removes a customer record by accident.
-- subscriptions is deliberately NOT guarded: Square is its system of record and the checkout
-- self-heal legitimately clears dead pending rows that never reached Square.

-- 1) audit coverage catches up (0042 covered orders/subscriptions/profiles/reserves/claims/…)
do $$
declare
  t text;
  tables text[] := array['drop_orders','delivery_orders','delivery_waitlist','rsvps',
                         'referral_events','check_ins','subscription_interest','reviews'];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;

-- 2) the delete guard
create or replace function public.guard_customer_delete()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('gt3.allow_hard_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Hard deletes are blocked on % — customer records are never lost. Cancel/archive instead. Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', tg_table_name;
end $$;

do $$
declare
  t text;
  tables text[] := array['profiles','orders','drop_orders','delivery_orders','delivery_waitlist',
                         'rsvps','referral_events','check_ins','subscription_interest','reviews',
                         'reserve_claims','audit_log','strategy_decisions'];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists guard_delete_%1$s on public.%1$I', t);
      execute format('create trigger guard_delete_%1$s before delete on public.%1$I for each row execute function public.guard_customer_delete()', t);
    end if;
  end loop;
end $$;

-- verify:
--   select count(*) from pg_trigger where tgname like 'guard_delete_%' and not tgisinternal;  -- 13
--   select count(*) from pg_trigger where tgname like 'audit\_%' escape '\' and not tgisinternal;  -- >= 16
--   delete from public.profiles where false;  -- runs; a real delete without the hatch raises
