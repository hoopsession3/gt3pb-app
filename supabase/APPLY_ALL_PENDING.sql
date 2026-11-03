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
-- pending-from: 0473
-- generated-at: 2026-11-03
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0473_a_course_and_a_research_bill_are_the_right_peoples.sql
-- ============================================================
begin;   -- 0473, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0473 — A COURSE AND A RESEARCH BILL ARE THE RIGHT PEOPLE'S (IMS8 security review, for review — NOT applied) ──────
-- 2026-11-03. Ryan: "course_students: establish which crew roles need student names, emails and order totals. Restrict
-- fields and access to that purpose… std_research_settle: determine whether a caller can under-report costs or bypass the
-- budget. Prepare server-controlled accounting with reservations, reconciliation and replay protection where missing."
-- A second run changes nothing.
--
-- WHAT WAS FOUND (production, read 2026-11-03; the functions' text identical to the repo's — the course three modulo
-- whitespace and comments):
--   · course_students() answered any crew member (is_staff): every student's name, email, user id, what they paid and
--     the owner's note. The only screen that lists students (Catalog › GT3 Nutrition · students) is drawn for owners and
--     admins only; the customer record (any crew) used the same list to show one customer's course line.
--   · program_access had "access staff manage" FOR ALL to any crew member (0271): crew could give or take back the course
--     by writing the table directly, around course_give / course_take_back, which ask for an owner or admin. Nothing in
--     the app writes it from the browser (the course's checkout writes it with the server's key; the two doors are
--     definers).
--   · std_research_settle() was callable by any owner or admin from their own browser (granted to authenticated) and took
--     the cost as the caller said it: settling a running run first, at $0, made the server's own settle fail ("already
--     settled") and the day's budget count less than was spent.
--
-- WHAT CHANGES.
--   · course_students(): owners and admins only (is_admin, so with the second step where it's required). Unchanged
--     fields — the students list is theirs: who, how to reach them, what they paid, the note.
--   · course_status(customer) — new, SECURITY INVOKER (no new privileged function): one customer's course line for the
--     customer record — how they got it, when, taken back, progress — read under the caller's own row rules (crew read
--     program_access and progress already). What they paid and the note only for an owner or admin; never a name, an
--     email or a user id (the record already shows the customer).
--   · program_access: the crew's FOR ALL write policy goes. Reads stay as they were. Writes: course_give / course_take_back
--     (owners and admins), and the server's key (checkout).
--   · std_research_settle(run, usage, cost, outcome, error) — the browser's door — is dropped. In its place
--     std_research_settle_server(tenant, run, usage, cost, outcome, error, key), granted to the server's role only: the
--     route computes the cost from the model's own usage report and settles with its key after the caller's reservation.
--     Once only: a run settles once; the same key again answers the same charge (a retry), any other key is refused
--     (PT409). Incomplete usage still charges the full reservation. A run nobody settles is charged its full reservation
--     by the next reservation (0462, unchanged). The day's cap is still checked at reserve, under the budget row's lock.
--
-- set lock_timeout (database F16): one policy dropped; one function replaced (same signature); one invoker function
-- added; one function dropped and one added (definer, service_role only); one nullable column added (no rewrite).
-- existing rows: none changed.
-- rollback: re-run 0444's course_students; drop function course_status; recreate 0271's "access staff manage"; recreate
--   0462's std_research_settle and its grant; drop function std_research_settle_server; alter table std_research_runs
--   drop column settle_key.
-- changelog: none — who may read a list and settle a bill; nothing a customer sees.

set lock_timeout = '5s';

-- ── course_students: owners and admins ──────────────────────────────────────────────────────────────────────────────
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
   where pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and (select public.is_admin())   -- 0473: was is_staff
   order by pa.granted_at desc;
$$;
revoke all on function public.course_students() from public, anon, authenticated;
grant execute on function public.course_students() to authenticated;

-- ── course_status: one customer's course line, as the caller may read it ───────────────────────────────────────────
create or replace function public.course_status(p_customer uuid)
returns table (source text, granted_at timestamptz, revoked_at timestamptz, paid_cents int, note text,
               done int, total int, rookie_done int, rookie_total int, last_done_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with live as (
    select l.id, l.tier from public.primal_lessons l
     where l.published_at is not null and l.archived_at is null and l.tenant_id = public.effective_tenant()
  ), admin as (select coalesce(public.is_admin(), false) a)
  select pa.source, pa.granted_at, pa.revoked_at,
         case when (select a from admin) then (select o.total_cents from public.shop_orders o where o.id = pa.order_id) end,
         case when (select a from admin) then pa.note end,
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed'),
         (select count(*)::int from live),
         (select count(*)::int from public.primal_progress p join live on live.id = p.lesson_id where p.customer_id = pa.customer_id and p.status = 'completed' and live.tier = 'rookie'),
         (select count(*)::int from live where live.tier = 'rookie'),
         (select max(p.completed_at) from public.primal_progress p where p.customer_id = pa.customer_id and p.status = 'completed')
    from public.program_access pa
   where pa.customer_id = p_customer and pa.tier = 'pro' and pa.tenant_id = public.effective_tenant() and (select public.is_staff());
$$;
revoke all on function public.course_status(uuid) from public, anon, authenticated;
grant execute on function public.course_status(uuid) to authenticated;

-- ── program_access: the crew no longer write it directly ────────────────────────────────────────────────────────────
drop policy if exists "access staff manage" on public.program_access;

-- ── research: the bill is settled by the server, once ───────────────────────────────────────────────────────────────
alter table public.std_research_runs add column if not exists settle_key uuid;

drop function if exists public.std_research_settle(uuid, jsonb, numeric, text, text);

create or replace function public.std_research_settle_server(p_tenant uuid, p_run uuid, p_usage jsonb, p_cost_cents numeric, p_outcome text,
                                                             p_error text, p_key uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare r public.std_research_runs; v_complete boolean; v_charge numeric;
begin
  if p_tenant is null or p_key is null then raise exception 'A settle names its business and its key.' using errcode = 'PT422'; end if;
  select * into r from public.std_research_runs where id = p_run and tenant_id = p_tenant for update;
  if not found then raise exception 'No such run.' using errcode = 'PT404'; end if;
  if r.outcome <> 'running' then
    if r.settle_key = p_key then return r.charged_cents; end if;   -- the same settle, again: the same answer
    raise exception 'This run is already settled.' using errcode = 'PT409';
  end if;
  if p_outcome not in ('done','failed','timed_out','cancelled') then raise exception 'An outcome is done, failed, timed_out or cancelled.' using errcode = 'PT422'; end if;
  v_complete := p_usage is not null and p_cost_cents is not null and p_cost_cents >= 0
    and (select bool_and(p_usage ? k and jsonb_typeof(p_usage -> k) = 'number') from unnest(array['searches','fetches','input_tokens','output_tokens']) k);
  v_charge := case when v_complete then p_cost_cents else r.reserved_cents end;
  update public.std_research_runs set
    searches = (p_usage ->> 'searches')::int, fetches = (p_usage ->> 'fetches')::int,
    input_tokens = (p_usage ->> 'input_tokens')::int, output_tokens = (p_usage ->> 'output_tokens')::int,
    cache_write_tokens = (p_usage ->> 'cache_write_tokens')::int, cache_read_tokens = (p_usage ->> 'cache_read_tokens')::int,
    charged_cents = v_charge, outcome = case when v_complete then p_outcome else 'unreported' end,
    error = left(p_error, 500), settled_at = now(), settle_key = p_key
  where id = p_run;
  return v_charge;
end $$;
revoke all on function public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid) to service_role;

-- verify (names and booleans only):
--   select has_function_privilege('authenticated', 'public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid)', 'execute');  -- f
--   select count(*) from pg_proc where proname = 'std_research_settle';                                                                          -- 0
--   select count(*) from pg_policies where tablename = 'program_access' and policyname = 'access staff manage';                                   -- 0
select public.record_migration('0473_a_course_and_a_research_bill_are_the_right_peoples');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0473
