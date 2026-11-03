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
--   · course_status(customer) — new, SECURITY DEFINER (one more privileged function, counted, not hidden): one
--     customer's course line for the customer record — how they got it, when, taken back, progress. It checks the
--     caller itself: crew of the customer's own business (is_staff, effective_tenant). What they paid and the note only
--     for an owner or admin; never a name, an email or a user id (the record already shows the customer). A definer,
--     because the crew no longer read program_access directly (below), and an invoker could not mask a column the
--     caller can read anyway.
--     The crew's one workflow that reaches it: a shop-order alert → the order → the customer's name → the customer
--     record (components/ShopOrderRecord → CustomerRecord → CrmDetail → CourseOnRecord).
--   · program_access: the crew's FOR ALL write policy goes; the crew's read of every row goes ("access owner read" was
--     is_staff OR own). Now: a customer reads their own rows; owners and admins read the business's. Writes:
--     course_give / course_take_back (owners and admins), and the server's key (checkout). Nothing in the browser
--     reads another customer's row (PrimalAcademy and /api/nutrition/map read the caller's own).
--   · shop_orders / shop_order_items: the crew's FOR ALL write policies ("shop orders staff manage", "shop items staff
--     manage", 0271-era) go. Every change the app makes goes through a door that asks for itself: set_shop_order_status
--     and shop_apliiq_checked (definers, is_staff), checkout and the printer's webhook (the server's key). Nothing in
--     the browser writes either table (searched 2026-11-03). Crew keep reading orders (the alert-opened order record
--     needs who, where to ship, what's in it); deletes stay owner/admin-only by the restrictive policy — and with no
--     permissive delete left, nobody deletes an order from a session at all (none does today).
--   · set_shop_order_status(order, …): found by this review — it locked the order by id alone (0417), so an owner or crew
--     member of another business who had an order's id could move it (cancel, refund). Now it asks the order to be the
--     caller's business's, as shop_apliiq_checked already did. Same body otherwise; same grants. (Production has one
--     business, so no other business's crew exists today; the test makes one.)
--   · merch_fulfillments: "fulfillments staff" FOR ALL (0271) becomes read-only for the crew — a session could write a
--     shipment and tracking number nobody shipped. The printer's webhook writes it with the server's key.
--   · std_research_settle(run, usage, cost, outcome, error) — the browser's door — is dropped. In its place
--     std_research_settle_server(tenant, run, usage, cost, outcome, error, key), granted to the server's role only: the
--     route computes the cost from the model's own usage report and settles with its key after the caller's reservation.
--     Once only: a run settles once; the same key again answers the same charge (a retry), any other key is refused
--     (PT409). Incomplete usage still charges the full reservation. A run nobody settles is charged its full reservation
--     by the next reservation (0462, unchanged). The day's cap is still checked at reserve, under the budget row's lock.
--   · vision_shared(token): sixty opens of live links per ten minutes from one address (caller_address, 0436 — the
--     Cloudflare address in front of the API; IPv6 by /64); the sixty-first is refused (PT429), not counted, and the
--     link's opens don't move. Without an address (no header) there's no limit, as 0436. A wrong or dead token still
--     raises PT404 — and a raise undoes the transaction, so misses can't be counted here: a flood of guesses costs one
--     index probe each and is NOT limited by the database (an edge rule is the only place that can; see IMS8-STATUS).
--     The token's length is not flood protection and isn't treated as such.
--   · customers_total() — new, SECURITY DEFINER: the number of this business's customers, to crew (is_staff); null to
--     anyone else. For the Goals card; no row, no field. (0474, after the app, takes the crew's row read away.)
--   · std_research_settle_server, settle vs. its deadline: a run the next reservation closed (unreported, no settle key)
--     still takes its own late report, charged the higher of the two, never lower than what the day counted.
--   · vision_shares.opens / last_opened_at: commented as what they are — raw door calls (a reload, a preview bot or a
--     second tab each count), not views or engagement.
--
-- set lock_timeout (database F16): six policies dropped and two created; two functions replaced (same signatures); three
-- definer functions added (course_status; customers_total; std_research_settle_server, service_role only); one function dropped; one
-- function's body replaced (vision_shared, same signature and grants); one nullable column added (no rewrite); two
-- column comments. existing rows: none changed.
-- rollback: supabase/cleanup/0473_rollback.sql. It restores every 0473 change EXCEPT the cross-business fix on
--   set_shop_order_status (kept on purpose: rolling back must not reopen it; 0473_rollback_including_order_scope.sql
--   exists only for a proven defect in that one line). Limits: dropping settle_key loses the keys of runs settled since,
--   so a late retry of one is refused (PT409) not answered; rate-limit rows age out; the column comments are left.
-- changelog: none — who may read a list, write an order and settle a bill; nothing a customer sees.

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
language sql stable security definer set search_path = public as $$
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

-- ── program_access: the crew no longer write it, or read every customer's ───────────────────────────────────────────
drop policy if exists "access staff manage" on public.program_access;
drop policy if exists "access owner read" on public.program_access;
drop policy if exists "access own or admin read" on public.program_access;
create policy "access own or admin read" on public.program_access for select using (
  (select public.is_admin())
  or exists (select 1 from public.customers c where c.id = program_access.customer_id and c.user_id = (select auth.uid()))
);

-- ── shop orders: changed through their doors, not written from a session ─────────────────────────────────────────────
drop policy if exists "shop orders staff manage" on public.shop_orders;
drop policy if exists "shop items staff manage" on public.shop_order_items;
-- merch_fulfillments (where an order shipped, its tracking): written only by the printer's webhook with the server's key
-- (app/api/apliiq/fulfillment); the crew read it (v_shop_orders joins it for the order record).
drop policy if exists "fulfillments staff" on public.merch_fulfillments;
drop policy if exists "fulfillments staff read" on public.merch_fulfillments;
create policy "fulfillments staff read" on public.merch_fulfillments for select using ((select public.is_staff()));

-- set_shop_order_status: the caller's own business's order (0417's body, one line changed — found by this review's
-- cross-business test: another business's owner could cancel or refund our order by its id).
create or replace function public.set_shop_order_status(
  p_order uuid, p_status text, p_note text default null, p_refund_cents int default null)
returns public.shop_orders
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; legal text[]; amt int; left_cents int;
begin
  if not public.is_staff() then raise exception 'Only crew can move a shop order.'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  -- 0473: the caller's own business's order only (was any order, any business; shop_apliiq_checked already asked).
  if not found or o.tenant_id is distinct from public.effective_tenant() then raise exception 'That order no longer exists.'; end if;
  if p_status = o.status then raise exception 'That order is already %.', o.status; end if;

  legal := case o.status
    when 'paid'              then array['needs_fulfillment','submitted','canceled','refunded']
    when 'needs_fulfillment' then array['submitted','shipped','canceled','refunded']
    -- needs_fulfillment added 2026-09-30: the printer can refuse an order AFTER we send it and
    -- says so only by email to the account owner, so an order handed back had nowhere honest to
    -- go. This is the ONLY line of 0313's function this migration changes; the rest is spliced
    -- from 0313's own text, unread by human hands, because retyping it silently altered five
    -- behaviours on the first attempt — including turning `amt <= 0` into `amt < 0`, which
    -- would have let a zero-cent refund mark an order refunded.
    when 'submitted'         then array['needs_fulfillment','in_production','shipped','canceled','refunded']
    when 'in_production'     then array['shipped','refunded']
    when 'shipped'           then array['delivered','refunded']
    when 'delivered'         then array['refunded']
    when 'canceled'          then array['refunded']
    else array[]::text[] end;

  if not (p_status = any(legal)) then
    if cardinality(legal) = 0 then
      raise exception 'This order is %. That is the end of its life — nothing moves it from here.', o.status;
    end if;
    raise exception 'An order that is % can go to: %. Not %.', o.status, array_to_string(legal, ', '), p_status;
  end if;

  -- The two that cost a customer something get a mandatory reason. Same rule as void_expense (0292)
  -- and the voids in 0309, and it matters more here because there is a person on the other end.
  if p_status in ('refunded','canceled') and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why. A refund or a cancellation with no reason is unreadable in six weeks, and this one has a customer attached to it.';
  end if;

  if p_status = 'refunded' then
    -- 0417: this refund's amount — none given is all that is left — between a cent and what is left.
    left_cents := coalesce(o.total_cents, 0) - coalesce(o.refund_amount_cents, 0);
    amt := coalesce(p_refund_cents, left_cents);
    if amt <= 0 or amt > left_cents then
      raise exception 'A refund has to be between 1 cent and the $% still on this order.',
        to_char(greatest(left_cents, 0) / 100.0, 'FM999999990.00');
    end if;
    if amt < left_cents then
      -- A part: added to what went back, and the order stays where it is — still to make, still to send.
      update public.shop_orders
         set refund_amount_cents = coalesce(refund_amount_cents, 0) + amt,
             status_note         = nullif(btrim(coalesce(p_note, '')), ''),
             updated_at          = now()
       where id = p_order
       returning * into o;
      return o;
    end if;
    amt := coalesce(o.total_cents, 0);   -- the refund that leaves nothing: all of it has gone back
  end if;

  update public.shop_orders
     set status              = p_status,
         status_note         = nullif(btrim(coalesce(p_note, '')), ''),
         status_changed_at   = now(),
         status_changed_by   = auth.uid(),
         refund_amount_cents = coalesce(amt, refund_amount_cents),
         updated_at          = now()
   where id = p_order
   returning * into o;
  return o;
end $$;

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
  if r.settle_key is not null then
    if r.settle_key = p_key then return r.charged_cents; end if;   -- the same settle, again: the same answer
    raise exception 'This run is already settled.' using errcode = 'PT409';
  end if;
  -- Not running and never settled by anyone = closed by its deadline (0462: the next reservation charges a run left
  -- open its full reservation, under the budget's lock). Its own report may still arrive: it's taken, but the charge
  -- never goes below what the day already counted (the higher of the two), so a late report can't lower a budget
  -- another reservation was decided against.
  if r.outcome <> 'running' and r.outcome <> 'unreported' then
    raise exception 'This run is already settled.' using errcode = 'PT409';
  end if;
  if p_outcome not in ('done','failed','timed_out','cancelled') then raise exception 'An outcome is done, failed, timed_out or cancelled.' using errcode = 'PT422'; end if;
  v_complete := p_usage is not null and p_cost_cents is not null and p_cost_cents >= 0
    and (select bool_and(p_usage ? k and jsonb_typeof(p_usage -> k) = 'number') from unnest(array['searches','fetches','input_tokens','output_tokens']) k);
  v_charge := case when v_complete then p_cost_cents else r.reserved_cents end;
  if r.outcome = 'unreported' then v_charge := greatest(v_charge, r.charged_cents); end if;
  update public.std_research_runs set
    searches = (p_usage ->> 'searches')::int, fetches = (p_usage ->> 'fetches')::int,
    input_tokens = (p_usage ->> 'input_tokens')::int, output_tokens = (p_usage ->> 'output_tokens')::int,
    cache_write_tokens = (p_usage ->> 'cache_write_tokens')::int, cache_read_tokens = (p_usage ->> 'cache_read_tokens')::int,
    charged_cents = v_charge, outcome = case when v_complete then p_outcome else 'unreported' end,
    error = left(case when r.outcome = 'unreported' then concat_ws(' · ', 'reported after its deadline', p_error) else p_error end, 500),
    settled_at = now(), settle_key = p_key
  where id = p_run;
  return v_charge;
end $$;
revoke all on function public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid) to service_role;

-- ── customers_total: the size of the customer book, not the book ──────────────────────────────────────────────────
-- The Goals card "Customers" (leads see it; a lead may not be an admin) counted the customers table directly, which
-- needed the crew's read of every customer row. A count is all it needs. 0474 then narrows the rows to owners/admins.
create or replace function public.customers_total()
returns int language sql stable security definer set search_path = public as $$
  select case when (select public.is_staff())
              then (select count(*)::int from public.customers where tenant_id = public.effective_tenant())
         end;
$$;
revoke all on function public.customers_total() from public, anon, authenticated;
grant execute on function public.customers_total() to authenticated;

-- ── a link's door: limited per address ──────────────────────────────────────────────────────────────────────────────
create or replace function public.vision_shared(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.vision_shares; v_from text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  select * into s from public.vision_shares
   where token = p_token and revoked_at is null and (expires_at is null or expires_at > now()) and published is not null;
  if not found then
    raise exception 'This link isn''t live.' using errcode = 'PT404';
  end if;
  -- 0473: counted only when the open would succeed (a raise below would undo the count anyway).
  v_from := public.caller_address();
  if v_from is not null and not public.rate_limit_hit('vision_shared:' || v_from, 600000, 60) then
    raise exception 'Too many opens from this network — try again in a few minutes.' using errcode = 'PT429';
  end if;
  perform set_config('gt3.share_open', 'on', true);
  update public.vision_shares set opens = opens + 1, last_opened_at = now() where id = s.id;
  perform set_config('gt3.share_open', 'off', true);
  return public.vision_share_live(s);
end $$;
revoke all on function public.vision_shared(text) from public, anon, authenticated;
grant execute on function public.vision_shared(text) to anon, authenticated;

comment on column public.vision_shares.opens is
  'Raw door calls (vision_shared answered a live link): a reload, a second tab or a link-preview bot each count; at most sixty per ten minutes per address (0473). Not views, not people, not engagement.';
comment on column public.vision_shares.last_opened_at is
  'When vision_shared last answered this link (any caller, 0473). Not proof a person read it.';

-- verify (names and booleans only):
--   select has_function_privilege('authenticated', 'public.std_research_settle_server(uuid, uuid, jsonb, numeric, text, text, uuid)', 'execute');  -- f
--   select count(*) from pg_proc where proname = 'std_research_settle';                                                                          -- 0
--   select count(*) from pg_policies where tablename = 'program_access' and policyname in ('access staff manage','access owner read');            -- 0
--   select count(*) from pg_policies where tablename in ('shop_orders','shop_order_items') and policyname like '%staff manage';                   -- 0
--   select prosecdef from pg_proc where proname = 'course_status';                                                                               -- t
select public.record_migration('0473_a_course_and_a_research_bill_are_the_right_peoples');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
