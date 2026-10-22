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
-- pending-from: 0444
-- generated-at: 2026-10-22
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0442_the_course_is_bought_and_the_pillars_are_given.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0444_the_owner_sees_who_has_the_course.sql
-- ============================================================
begin;   -- 0444, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0444 — THE OWNER SEES WHO HAS THE COURSE, AND GIVES IT ──────────────────────────────────────────────────────────
-- 2026-10-22. R47 (Ryan, 2026-10-22: "can i give access in settings somewhere? how can i see the users… a member's
-- profile should show if they enrolled and all of the other stuff… industry standard"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. GT3 Nutrition sells (0443), and nothing showed who has it: a purchase was a shop order, the access a row no screen
-- read, and the only way to give someone the course was to write that row by hand. Every course platform has a
-- students list, a student's progress on their record, and "give access" / "remove access" for the owner.
--
-- WHAT.
--   1. program_access says who: note (why it was given), granted_by, revoked_by — and every change to it is in the admin
--      audit trail (0260's trigger), so a given or taken course is never a mystery. An account deleted (0353) takes its
--      course and its note with it; the sale stays in the books.
--   2. course_give(customer, note) / course_take_back(customer): an owner's or an admin's (is_admin, with two-step,
--      0433). Give is a comp (source 'comp', no order — a refund can't touch it); take back revokes whatever is live.
--   3. course_students(): the crew's read of every customer who has or had the course — how they got it, what it cost,
--      when, their progress (lessons done of live lessons, Rookie done of Rookie), when they last finished one. Staff
--      only; anyone else gets nothing.
--
-- set lock_timeout (database F16): three columns, three functions, one audit trigger.
-- existing rows: none changed.
-- changelog: none — the crew's own screens.

set lock_timeout = '5s';

-- 1 · who gave it, who took it, why — and the audit trail
alter table public.program_access add column if not exists note text;
alter table public.program_access add column if not exists granted_by uuid;
alter table public.program_access add column if not exists revoked_by uuid;
drop trigger if exists audit_program_access on public.program_access;
create trigger audit_program_access after insert or update or delete on public.program_access
  for each row execute function public.log_admin_audit();

-- …and when an account is deleted (0353, erase_account_data), its course goes with it: program_access cascades from the
-- customer record, and the erasure deletes every cascading row itself — the note with it. The sale stays in the books
-- (shop_orders, kept and emptied of them).

-- 2 · give, take back
create or replace function public.course_give(p_customer uuid, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare who uuid := auth.uid(); live boolean;
begin
  if not public.is_admin() then raise exception 'Only an owner or an admin gives the course.' using errcode = '42501'; end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = public.effective_tenant()) then
    raise exception 'No such customer.' using errcode = 'PT404';
  end if;
  select revoked_at is null into live from public.program_access where customer_id = p_customer and tier = 'pro';
  if live then return json_build_object('ok', true, 'already', true); end if;
  insert into public.program_access (customer_id, tier, source, order_id, note, granted_by, granted_at, revoked_at, revoked_by)
  values (p_customer, 'pro', 'comp', null, nullif(left(trim(coalesce(p_note, '')), 200), ''), who, now(), null, null)
  on conflict (customer_id, tier) do update
    set source = 'comp', order_id = null, note = excluded.note, granted_by = who, granted_at = now(), revoked_at = null, revoked_by = null;
  return json_build_object('ok', true, 'already', false);
end $$;

create or replace function public.course_take_back(p_customer uuid)
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an owner or an admin takes the course back.' using errcode = '42501'; end if;
  update public.program_access set revoked_at = now(), revoked_by = auth.uid()
   where customer_id = p_customer and tier = 'pro' and revoked_at is null and tenant_id = public.effective_tenant();
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'revoked', n);
end $$;

-- 3 · who has it, and how far they are
create or replace function public.course_students()
returns table (customer_id uuid, name text, email text, user_id uuid, source text, granted_at timestamptz, revoked_at timestamptz,
               order_id uuid, paid_cents int, note text, done int, total int, rookie_done int, rookie_total int, last_done_at timestamptz)
language sql stable security definer set search_path = public as $$
  with live as (
    select l.id, l.tier from public.primal_lessons l
     where l.published_at is not null and l.archived_at is null and l.tenant_id = public.effective_tenant()
  )
  select pa.customer_id, c.name, c.email, c.user_id, pa.source, pa.granted_at, pa.revoked_at, pa.order_id,
         (select o.total_cents from public.shop_orders o where o.id = pa.order_id),
         pa.note,
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed'),
         (select count(*)::int from live),
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed' and live.tier = 'rookie'),
         (select count(*)::int from live where live.tier = 'rookie'),
         (select max(p.completed_at) from public.primal_progress p where p.customer_id = pa.customer_id and p.status = 'completed')
    from public.program_access pa
    join public.customers c on c.id = pa.customer_id
   where pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and (select public.is_staff())
   order by pa.granted_at desc;
$$;

revoke all on function public.course_give(uuid, text) from public, anon, authenticated;
revoke all on function public.course_take_back(uuid) from public, anon, authenticated;
revoke all on function public.course_students() from public, anon, authenticated;
grant execute on function public.course_give(uuid, text) to authenticated;
grant execute on function public.course_take_back(uuid) to authenticated;
grant execute on function public.course_students() to authenticated;

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.course_students()', 'execute');                -- f
--   select count(*) from pg_trigger where tgname = 'audit_program_access';                      -- 1
select public.record_migration('0444_the_owner_sees_who_has_the_course');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0444
