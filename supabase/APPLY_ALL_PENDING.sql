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
-- pending-from: 0343
-- generated-at: 2026-10-04
-- pending-count: 3
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0341_the_window_says_what_it_took.sql
-- ============================================================
-- ── THE WINDOW SAYS WHAT IT TOOK ───────────────────────────────────────────────────────────────
-- 2026-10-04. Ryan, asked what next: "All four, in order." The first is money — recording it when
-- it arrives. Asked how a pre-order is paid at the window: "Both cash and reader."
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- 1. A PAY-AT-PICKUP ORDER COULD NEVER BE PAID. orders.paid is written true by exactly one thing,
--    app/api/checkout, when a card clears online; drop_orders.paid by exactly one, app/api/reserve
--    (0016 made both server-only, rightly). Nothing else in the app or the database sets either. So
--    a cup ordered "pay at the truck" printed "UNPAID · collect at pickup" on the pass and offered
--    nothing to press when the customer paid; the pack board summed "still to collect at the
--    window" over every pack that had not paid online, including the ones paid at the window an
--    hour earlier; the customer's own app said "$ at pickup" on a pack they had paid for; and the
--    CRM counted every one of them as an open balance, for ever (CrmPanel: open = not 'paid').
--
-- 2. AN INVOICE THE APP CREATED WAS INVISIBLE TO THE ONE PLACE THAT WATCHES MONEY OWED. The office
--    board's "Invoice" button inserts amount, terms and status — no due date. v_obligations (0320,
--    restated 0330) keeps an invoice only `where i.due_at is not null`, so every invoice this app
--    has ever written was outside it. And nothing anywhere marks an invoice paid: when the customer
--    pays the office payment link, the Square webhook settles the BUSINESS ORDER (0221) and the
--    invoice stays 'open' for ever. A due date added on its own would therefore have surfaced paid
--    invoices as overdue — which is why the same run settles them first.
--
-- 3. A CUSTOMER COULD STILL CANCEL WHAT THEY HAD PAID FOR IN CASH. cancel_own_order refuses once an
--    order is past 'new'; a cup paid at the window while still 'new' would cancel from the app with
--    "Nothing was charged", no refund flag, and the cash in the till for an order that no longer
--    exists. Same for a pack.
--
-- 4. A MEMBER COULD SAY THEIR OWN OFFICE ORDER WAS PAID. 0187 gave the ordering member INSERT and an
--    every-column UPDATE on their own business_orders rows ("biz order own insert", "biz order own
--    cancel") from when the client wrote them directly. Since app/api/office, every write is the
--    service role or staff; nothing in the app uses either policy (checked: app/office reads,
--    components/OfficeOrder posts to the API). What they still allow is a signed-in member setting
--    payment_status = 'paid' — counted as office revenue by report_sales, shown as paid on the
--    route — or inserting an order at any price. Section 6 below would have added a third thing to
--    that list (closing the invoice), so the policies go first.
--
-- ── WHY CASH AND THE READER ARE NOT THE SAME WRITE ─────────────────────────────────────────────
-- CASH goes in the till and nowhere else. If this database does not count it, nothing does. So a
-- cash collection sets paid = true and report_sales (0220) counts it exactly as it counts a card
-- paid online.
--
-- THE CARD READER IS SQUARE. The webhook mirrors every COMPLETED Square payment into event_sales,
-- and report_sales counts those as walk-up revenue unless the payment id is linked to an app order.
-- Nothing links a reader payment to a pre-order — the reader rings a fresh payment, its amount can
-- carry a tip, and two $9 orders at the same window are indistinguishable — so the reader's money
-- is ALREADY counted, as a walk-up. Setting paid = true as well would count it twice. A reader
-- collection therefore records that the customer owes nothing and leaves paid alone.
--
-- So "settled" — the customer owes nothing — is `paid or collected_at is not null`, and it gets ONE
-- home: the payment_status column 0155 added for exactly this, which the sync triggers derive. The
-- unified view (all_orders) had gone back to recomputing payment_status from `paid` inline — 0193
-- re-copied 0153's CASE to add the office channel, undoing 0155's "mapping logic now lives once, in
-- the triggers". It reads the columns again. lib/collect.ts isSettled() is the same rule for the
-- app, and scripts/db.collect.test.mjs runs both.
--
-- The crew is told this at the point of the tap (components/CollectSheet): cash is "in the till —
-- don't ring it on Square too"; the reader is "rung on Square — it counts there".
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. orders and drop_orders gain collected_via ('cash' | 'card_reader'), collected_at, collected_by.
-- 2. The 0155 sync triggers derive payment_status = 'paid' from paid OR collected_at.
-- 3. all_orders reads the trigger-maintained columns for cup, pickup and delivery (office has no
--    such columns and keeps its CASE).
-- 4. staff_collect_payment(kind, id, via) and staff_undo_collection(kind, id): staff only, tenant
--    scoped, row-locked. Undo is the collector's own within the hour, or an admin's; it can never
--    touch a card paid online (there is no collected_at to undo).
-- 5. cancel_own_order / cancel_own_reservation refuse once the money was taken at the window.
-- 6. The member write policies on business_orders are dropped (section 4 of WHAT WAS TRUE).
-- 7. Invoices: terms are 'net15' | 'net30' (guarded), a due date is set at insert from them, an
--    invoice follows its order (paid → paid, canceled → void), and mark_invoice_paid() settles the
--    invoice AND its order in one write, for a cheque or a transfer. The run that dates the open
--    invoices first settles the ones whose orders say they are paid, so none surfaces as overdue.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
-- It does not touch report_sales, report_events or founder_digest_alert. Their money sums count
-- `paid`, which is exactly right for both new paths (cash in, reader out — counted by Square). What
-- they do not do is count a reader-collected cup in order_count, the product mix, or a truck stop's
-- P&L — but before today those orders were counted in none of them either (never paid), so nothing
-- regresses; making those three count settled orders is a restatement of each function, and is its
-- own change.
-- It does not guess at history. An old pay-at-pickup order that was picked up and never marked is
-- still unsettled: whether it was paid is something this database was never told.

-- ── 1 · THE COLUMNS ────────────────────────────────────────────────────────────────────────────
-- One statement per column: scripts/columns.audit.mjs reads `alter table … add column` one column
-- at a time, and a column it cannot see arriving is a column it calls a typo.
alter table public.orders add column if not exists collected_via text check (collected_via in ('cash', 'card_reader'));
alter table public.orders add column if not exists collected_at timestamptz;
alter table public.orders add column if not exists collected_by uuid references auth.users(id) on delete set null;
alter table public.drop_orders add column if not exists collected_via text check (collected_via in ('cash', 'card_reader'));
alter table public.drop_orders add column if not exists collected_at timestamptz;
alter table public.drop_orders add column if not exists collected_by uuid references auth.users(id) on delete set null;

-- How and when are one fact: a method with no moment, or a moment with no method, is a half-write.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_collected_pair') then
    alter table public.orders add constraint orders_collected_pair
      check ((collected_via is null) = (collected_at is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drop_orders_collected_pair') then
    alter table public.drop_orders add constraint drop_orders_collected_pair
      check ((collected_via is null) = (collected_at is null));
  end if;
end $$;

-- ── 2 · SETTLED HAS ONE HOME: the 0155 triggers ────────────────────────────────────────────────
-- Both functions are 0155's, with the payment_status line widened and nothing else changed. The
-- triggers already exist (0155), so redefining the functions is enough.
create or replace function public.sync_order_status() returns trigger
language plpgsql as $$
begin
  new.fulfillment_status := case new.status
    when 'void' then 'canceled'
    when 'done' then 'fulfilled'
    when 'new'  then 'placed'
    else 'in_prep'  -- preparing / ready
  end;
  new.payment_status := case when new.paid or new.collected_at is not null then 'paid' else 'pending' end;
  return new;
end $$;

create or replace function public.sync_pack_status() returns trigger
language plpgsql as $$
begin
  if new.canceled_at is not null then
    new.fulfillment_status := 'canceled';
  else
    new.fulfillment_status := case new.stage
      when 'picked_up'  then 'fulfilled'
      when 'preparing'  then 'in_prep'
      when 'ready'      then 'ready'
      when 'en_route'   then 'ready'   -- assembled + moving; not yet in the customer's hands
      else 'placed'                    -- reserved
    end;
  end if;
  new.payment_status := case when new.paid or new.collected_at is not null then 'paid' else 'pending' end;
  return new;
end $$;

-- The view below reads these columns, so a row the 0155 backfill somehow missed must not read as
-- null. Writes only the two derived columns, only where one is missing (expected: none).
update public.orders set
  fulfillment_status = case status when 'void' then 'canceled' when 'done' then 'fulfilled' when 'new' then 'placed' else 'in_prep' end,
  payment_status = case when paid or collected_at is not null then 'paid' else 'pending' end
  where fulfillment_status is null or payment_status is null;
update public.drop_orders set
  fulfillment_status = case
    when canceled_at is not null then 'canceled'
    else case stage when 'picked_up' then 'fulfilled' when 'preparing' then 'in_prep'
                    when 'ready' then 'ready' when 'en_route' then 'ready' else 'placed' end
  end,
  payment_status = case when paid or collected_at is not null then 'paid' else 'pending' end
  where fulfillment_status is null or payment_status is null;
update public.delivery_orders set
  fulfillment_status = case
    when canceled_at is not null then 'canceled'
    when status = 'delivered' then 'fulfilled'
    when status = 'received' then 'placed'
    else 'in_prep'
  end
  where fulfillment_status is null;

-- ── 3 · THE UNIFIED VIEW READS THE COLUMNS AGAIN ───────────────────────────────────────────────
-- Same columns, same order, same types as 0193's, so `create or replace` keeps every grant and
-- every reader. Cup, pickup and delivery pass their trigger-maintained columns through (0155's
-- design); a pack being prepared now reads 'in_prep' / 'ready' rather than 0193's 'placed', which
-- is what the pack is. Delivery's payment_status column already holds exactly the four words 0193's
-- CASE mapped it onto. Office keeps its CASE: business_orders has no derived columns, and its
-- 'invoiced' is money still owed, so it reads 'pending'.
create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id,
    fulfillment_status, payment_status, total_cents, created_at
  from public.delivery_orders
  union all
  select 'office', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when status = 'delivered' then 'fulfilled' when status in ('received','brewed') then 'placed' else 'in_prep' end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, created_at
  from public.business_orders;

-- ── 4 · TAKING IT, AND TAKING IT BACK ──────────────────────────────────────────────────────────
-- kind is the channel word the cancel path already uses (cancel_any_order, all_orders): 'cup' for
-- an order on the pass, 'pickup' for a pack. Returns 'collected', or 'already settled' when the
-- order needs nothing — a second tap, a queued tap replayed after the signal came back, or a card
-- that cleared online in the meantime. Anything that is not a collection is an exception with a
-- sentence a person can read, because the pass shows it as one.
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader') then
    raise exception 'say how it was paid: cash or card_reader';
  end if;

  if p_kind = 'cup' then
    select paid, collected_at, status = 'void' into v_paid, v_at, v_gone
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null into v_paid, v_at, v_gone
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  end if;
  raise exception 'unknown kind: %', coalesce(p_kind, 'null');
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text) from public, anon;
grant execute on function public.staff_collect_payment(text, uuid, text) to authenticated;

-- A wrong tap is put right by the person who made it, while it is fresh — or by an admin, any
-- time. It clears the collection and, for cash only, the paid flag that cash set; a reader
-- collection never set paid, and a card paid online has no collection to clear, so neither can be
-- unpaid from here.
create or replace function public.staff_undo_collection(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_via text; v_at timestamptz; v_by uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_kind = 'cup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
  elsif p_kind = 'pickup' then
    select collected_via, collected_at, collected_by into v_via, v_at, v_by
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
  else
    raise exception 'unknown kind: %', coalesce(p_kind, 'null');
  end if;
  if not found then raise exception 'that order does not exist'; end if;
  if v_at is null then return 'nothing to undo'; end if;
  if not (public.is_admin() or (v_by = auth.uid() and v_at > now() - interval '1 hour')) then
    raise exception 'only the person who took it can undo it, within the hour — or an admin';
  end if;

  if p_kind = 'cup' then
    update public.orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  else
    update public.drop_orders
       set paid = case when v_via = 'cash' then false else paid end,
           collected_via = null, collected_at = null, collected_by = null
     where id = p_id;
  end if;
  return 'undone';
end $$;
revoke all on function public.staff_undo_collection(text, uuid) from public, anon;
grant execute on function public.staff_undo_collection(text, uuid) to authenticated;

-- ── 5 · WHAT WAS PAID AT THE WINDOW IS NOT CANCELED FROM A PHONE ───────────────────────────────
-- Both are 0242's, verbatim, with one refusal added each. The crew can still cancel a collected
-- order or pack; the person handing back the cash is the one who should.
-- existing rows: cancel_own_order — its refund alert's title and body are 0242's, byte for byte; only who may cancel changed
-- existing rows: cancel_own_reservation — the same: 0242's alert text unchanged, one refusal added before it
create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  -- FOR UPDATE added: cancel_own_reservation (0136) and cancel_own_delivery (0139) already lock
  -- their row here; this one didn't, so two concurrent cancels (double-tap / client retry) could
  -- both read status='new' before either write landed and both insert a refund alert.
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void
  if o.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it

  update public.orders set status = 'void' where id = p_order;

  -- A card-paid order that's canceled needs a refund in Square — flag the crew (best-effort inbox
  -- row; the app's push dispatcher fans it out). The refund itself is done in Square.
  if o.paid then
    insert into public.alerts (severity, category, title, body, link)
    values ('critical', 'money',
            'Customer canceled a paid order — refund needed',
            'A member canceled order #' || upper(substr(o.id::text, 1, 4)) ||
            ' ($' || to_char((o.total_cents / 100.0)::numeric, 'FM999990.00') || '). Refund it in Square.',
            '/admin');
  end if;
  return true;
end $$;

revoke all on function public.cancel_own_order(uuid) from public, anon;
grant execute on function public.cancel_own_order(uuid) to authenticated;

create or replace function public.cancel_own_reservation(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.drop_orders%rowtype;
begin
  select * into r from public.drop_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.picked_up then return false; end if;
  if r.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it
  update public.drop_orders set canceled_at = now() where id = p_id;
  if r.paid then
    insert into public.alerts (severity, category, title, body, link) values (
      'critical', 'money', 'Member canceled a PAID reservation — refund needed',
      r.name || ' · ' || r.size || '-pack · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.drop_date, 'Dy Mon DD') || '''s drop. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;

grant execute on function public.cancel_own_reservation(uuid) to authenticated;
revoke execute on function public.cancel_own_reservation(uuid) from anon;

-- ── 6 · A MEMBER DOES NOT WRITE THEIR OWN OFFICE ORDER ─────────────────────────────────────────
-- Reading stays ("biz order own read" — app/office lists them). Staff keep "biz order staff".
drop policy if exists "biz order own insert" on public.business_orders;
drop policy if exists "biz order own cancel" on public.business_orders;

-- ── 7 · INVOICES ───────────────────────────────────────────────────────────────────────────────
-- 7a. Terms are the two the app writes (OfficeOrders: net30, else net15). Guarded the 0238 way: a
--     value already outside them is reported and the check skipped, never a failed migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_terms_check') then
    if exists (select 1 from public.invoices where terms is null or terms not in ('net15', 'net30')) then
      raise notice 'invoices.terms holds a value other than net15/net30 — check skipped; fix those rows and re-run';
    else
      alter table public.invoices add constraint invoices_terms_check check (terms in ('net15', 'net30'));
    end if;
  end if;
end $$;

-- 7b. An invoice follows its order. Paid there (the payment link's webhook, "Mark paid", or
--     mark_invoice_paid below) is paid here; canceled there is void here. Definer, because the
--     webhook writes as the service role and staff hold "invoice staff" — but since section 6 no
--     member can change business_orders at all, so nothing outside the crew reaches this.
create or replace function public.invoice_follows_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now())
     where business_order_id = new.id and status in ('open', 'sent');
  end if;
  if new.canceled_at is not null and old.canceled_at is null then
    update public.invoices set status = 'void'
     where business_order_id = new.id and status in ('open', 'sent');
  end if;
  return null;
end $$;
-- A trigger function is not an API: nobody calls it, so nobody is granted it.
revoke all on function public.invoice_follows_order() from public, anon, authenticated;
drop trigger if exists invoice_follows_order_tg on public.business_orders;
create trigger invoice_follows_order_tg after update of payment_status, canceled_at on public.business_orders
  for each row execute function public.invoice_follows_order();

-- 7c. The due date, set where every writer passes: at insert, from the terms, counted from the ET
--     day it was issued. A due date someone sets on purpose is kept.
create or replace function public.invoice_due_from_terms() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.due_at is null then
    new.due_at := (coalesce(new.issued_at, now()) at time zone 'America/New_York')::date
                  + case new.terms when 'net30' then 30 else 15 end;
  end if;
  return new;
end $$;
drop trigger if exists invoice_due_from_terms_tg on public.invoices;
create trigger invoice_due_from_terms_tg before insert on public.invoices
  for each row execute function public.invoice_due_from_terms();

-- 7d. The backfills. Settle and void from what the orders already say, then date what is still
--     owed. They go together, in one run, because the dates alone would have made every invoice
--     whose order was paid by link arrive in v_obligations as overdue (v_obligations reads only
--     'open' and 'sent'). paid_at stays null on a backfilled row: when it was paid is not
--     something this database was told.
update public.invoices i set status = 'paid'
  from public.business_orders b
 where b.id = i.business_order_id and b.payment_status = 'paid' and i.status in ('open', 'sent');
update public.invoices i set status = 'void'
  from public.business_orders b
 where b.id = i.business_order_id and b.canceled_at is not null and i.status in ('open', 'sent');
update public.invoices
   set due_at = (issued_at at time zone 'America/New_York')::date + case terms when 'net30' then 30 else 15 end
 where due_at is null;

-- 7e. The cheque, the transfer, the cash at the office door: money in by a way Square does not
--     see. Owners and admins — Money is theirs (OperatorNav). Settles the invoice and its order in
--     one write; the order's trigger then finds the invoice already paid and leaves it.
create or replace function public.mark_invoice_paid(p_invoice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_admin() then raise exception 'only an owner or admin can mark an invoice paid'; end if;
  select * into v from public.invoices
   where id = p_invoice and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'that invoice does not exist'; end if;
  if v.status = 'paid' then return 'already paid'; end if;
  if v.status = 'void' then raise exception 'that invoice was voided — its order was canceled'; end if;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice;
  if v.business_order_id is not null then
    update public.business_orders set payment_status = 'paid'
     where id = v.business_order_id and payment_status in ('pending', 'invoiced', 'failed');
  end if;
  return 'paid';
end $$;
revoke all on function public.mark_invoice_paid(uuid) from public, anon;
grant execute on function public.mark_invoice_paid(uuid) to authenticated;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Money taken at the window is recorded, and invoices have due dates','feature','Money',
   'A pay-at-pickup order could never be marked paid: only an online card ever set it, so the pass said "unpaid" for ever and the pickup board kept counting money already collected. The pass and the pickup board now take it in one tap — cash, or the card reader — and say which. Cash counts as revenue here; the reader is already counted by Square, so it is recorded as settled without being counted twice. The customer''s app shows it paid, and a member can no longer cancel from their phone something they paid for at the window. Office invoices now get a due date from their terms, so they appear under Needs you when they come due, with one tap to mark them paid; an invoice whose order was paid by link is marked paid automatically.',
   '2026-10-04', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0341_the_window_says_what_it_took',
  'Window collection: orders/drop_orders.collected_via (cash|card_reader), collected_at, collected_by + pair check. Cash sets paid (the till is counted nowhere else); the reader does not (Square mirrors every completed payment into event_sales and report_sales counts unlinked ones as walk-ups — paid as well would count it twice). Settled = paid or collected_at, one home: the 0155 sync triggers derive payment_status from it; all_orders reads the trigger columns again for cup/pickup/delivery (0193 had re-inlined 0153''s CASE). staff_collect_payment / staff_undo_collection (staff, tenant-scoped, locked; undo own-within-the-hour or admin; never unpays an online card). cancel_own_order / cancel_own_reservation refuse once collected (0242 verbatim plus one line each). Dropped "biz order own insert" and "biz order own cancel": unused since app/api/office, and they let a member mark their own office order paid. Invoices: terms check (guarded), due_at from terms at insert, invoice follows its order (paid→paid, canceled→void), backfilled settle + void from their orders in the same run that dates the rest, so a link-paid invoice never surfaces overdue; mark_invoice_paid (admin) settles invoice and order. report_sales/report_events/founder_digest untouched: money sums on paid are right for both paths; counting reader-collected cups in order_count/product mix/stop P&L is a separate restatement.');

-- verify:
--   select column_name from information_schema.columns
--    where table_name in ('orders','drop_orders') and column_name like 'collected_%' order by 1;   -- 6 rows
--   select proname from pg_proc where proname in ('staff_collect_payment','staff_undo_collection','mark_invoice_paid');  -- 3
--   select prosrc like '%collected_at is not null%' from pg_proc where proname in ('cancel_own_order','cancel_own_reservation');  -- t, t
--   select polname from pg_policy where polrelid = 'public.business_orders'::regclass order by 1;
--     -- biz order own read · biz order staff · business_orders_delete_admin_only (0308) · tenant isolation (0239)
--     -- and no "biz order own insert" / "biz order own cancel"
--   select count(*) from public.invoices where due_at is null;                                        -- 0
--   select count(*) from public.invoices i join public.business_orders b on b.id = i.business_order_id
--    where b.payment_status = 'paid' and i.status in ('open','sent');                               -- 0
--   select channel, payment_status, count(*) from public.all_orders group by 1, 2 order by 1, 2;

-- ============================================================
-- 0342_checked_with_whom_and_when.sql
-- ============================================================
-- ── CHECKED WITH WHOM, AND WHEN ────────────────────────────────────────────────────────────────
-- 2026-10-04. The second of Ryan's four ("All four, in order"): a permit rule that falls due for a
-- re-check under Needs you could never leave it.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- 0284 gave every compliance rule a date — verified_on, "the date a human last confirmed this
-- against the issuing authority" — and v_compliance_freshness turned that date into a to-do: no
-- date, over six months, over a year, or never confirmed at all. 0320 put those to-dos under Needs
-- you ("Needs re-checking"). And nothing, anywhere in the app, writes verified_on. The only write
-- the app makes to a rule is the inspection agent's approve (crew page, InspectionPrep), which sets
-- verified without a date — so an approved rule arrived in Needs you at once, as "no date", and
-- stayed. A row on the list could be read, and could never be answered: calling the county, being
-- told the rule still stands, had nowhere to go but the SQL editor. And a row tapped went to the
-- top of Prep, where nothing about the rule is.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- 1. compliance_checks: one row per time a person checked a rule with someone who would know —
--    when, who, what they checked it against, what they found, and the rule as it stood before.
--    Append-only from the app: rows are written by the two functions below and nothing else, the
--    same rule square_refunds keeps, because a check anyone can insert is a check nobody can trust.
-- 2. recheck_compliance_rule(rule, outcome, checked_against, note): any staff member who checked
--    it. 'confirmed' — still true, today — sets verified, verified_on (the ET day) and verified_by,
--    and leaves Needs you. 'changed' — the authority says something else now — does NOT rewrite
--    the rule. It marks it unverified, says what changed and who said so, and tells the owners,
--    because a permit rule is changed by someone who can then be asked about it.
-- 3. correct_compliance_rule(...): owners and admins (0027's "compliance admin write"): the rule's
--    words, link, authority and deadline, rewritten from what the authority said, with where it
--    was checked — and the rule as it stood before kept in the check.
-- 4. compliance_rules.verified_by.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
-- It writes no rule. Nothing here says what a permit requires; every word a rule carries still
-- comes from a person who names where they got it, and "where you checked" is required — a check
-- with no source is the thing 0284 spent a migration removing. It does not let a re-check touch a
-- rule that is not on the checklist (an agent proposal still waiting for an admin's approval), and
-- it does not change who may approve those. It does not date anything retroactively: a rule nobody
-- has checked stays exactly as stale as it is.

-- ── 1 · WHO CHECKED A RULE, WITH WHOM, AND WHAT THEY FOUND ─────────────────────────────────────
alter table public.compliance_rules add column if not exists verified_by uuid references auth.users(id) on delete set null;
comment on column public.compliance_rules.verified_by is
  'Who last confirmed or corrected this rule (0342). The check itself — when, against what, what was found — is in compliance_checks.';

create table if not exists public.compliance_checks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  rule_id         uuid not null references public.compliance_rules(id) on delete cascade,
  checked_on      date not null,
  checked_by      uuid references auth.users(id) on delete set null,
  outcome         text not null check (outcome in ('confirmed', 'changed', 'corrected')),
  checked_against text not null check (length(btrim(checked_against)) >= 3),
  note            text,
  before          jsonb not null,
  created_at      timestamptz not null default now()
);
create index if not exists compliance_checks_rule on public.compliance_checks (rule_id, created_at desc);

drop trigger if exists stamp_tenant_tg on public.compliance_checks;
create trigger stamp_tenant_tg before insert on public.compliance_checks
  for each row execute function public.stamp_tenant();

alter table public.compliance_checks enable row level security;
drop policy if exists compliance_checks_read on public.compliance_checks;
create policy compliance_checks_read on public.compliance_checks for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.compliance_checks;
create policy "tenant isolation" on public.compliance_checks as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
-- No insert, update or delete policy for `authenticated`, on purpose — see WHAT THIS DOES (1). The
-- grants say the same thing as the policies, so neither has to be read to know the other.
revoke all on public.compliance_checks from public, anon;
revoke insert, update, delete on public.compliance_checks from authenticated;
grant select on public.compliance_checks to authenticated;

comment on table public.compliance_checks is
  'Every time a person checked a compliance rule with someone who would know: when, who, against what, and what they found (confirmed / changed / corrected), with the rule as it stood before. Written only by recheck_compliance_rule and correct_compliance_rule.';

-- ── 2 · RE-CHECKED: STILL TRUE, OR NOT ─────────────────────────────────────────────────────────
-- existing rows: recheck_compliance_rule — a new producer; nothing has ever written a compliance_changed alert
create or replace function public.recheck_compliance_rule(
  p_rule uuid, p_outcome text, p_checked_against text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_rules%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  src text := btrim(coalesce(p_checked_against, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  who text;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_outcome is null or p_outcome not in ('confirmed', 'changed') then
    raise exception 'say what you found: confirmed or changed';
  end if;
  if length(src) < 3 then
    raise exception 'say where you checked it — the county, the agency, the page or the person';
  end if;
  if p_outcome = 'changed' and (note is null or length(note) < 3) then
    raise exception 'say what has changed, so the rule can be corrected';
  end if;

  select * into r from public.compliance_rules
   where id = p_rule and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'that rule does not exist'; end if;
  if not r.active then raise exception 'that rule is not on the checklist — an admin approves it first'; end if;

  select coalesce(nullif(btrim(display_name), ''), 'a crew member') into who
    from public.profiles where id = auth.uid();
  who := coalesce(who, 'a crew member');

  insert into public.compliance_checks (rule_id, checked_on, checked_by, outcome, checked_against, note, before)
  values (r.id, today, auth.uid(), p_outcome, src, note,
          jsonb_build_object('label', r.label, 'link', r.link, 'authority', r.authority,
                             'lead_days', r.lead_days, 'lead_basis', r.lead_basis, 'verified', r.verified,
                             'verified_on', r.verified_on, 'check_note', r.check_note));

  if p_outcome = 'confirmed' then
    update public.compliance_rules
       set verified = true, verified_on = today, verified_by = auth.uid(),
           check_note = 'Re-checked ' || to_char(today, 'Mon FMDD, YYYY') || ' by ' || who
                        || ' against ' || src || '.' || coalesce(' ' || note, '')
     where id = r.id;
    return 'confirmed';
  end if;

  -- CHANGED. The rule's words stay exactly as they were — nobody here gets to write a permit
  -- requirement by summary — but it stops claiming to be confirmed, says what was heard and from
  -- whom, and the people who can correct it are told.
  update public.compliance_rules
     set verified = false, verified_by = auth.uid(),
         check_note = 'CHANGED, per ' || src || ' on ' || to_char(today, 'Mon FMDD, YYYY') || ' (' || who || '): '
                      || note || ' — not to be relied on until an admin corrects the rule.'
   where id = r.id;
  perform public.alert_open_once(
    'compliance_changed', r.id, 'important', 'prep',
    'A permit rule has changed — ' || left(r.label, 80),
    who || ' checked it against ' || src || ' and was told: ' || note || '. Correct the rule so the checklist says what is true.',
    '/crew?s=prep');
  return 'changed';
end $$;
revoke all on function public.recheck_compliance_rule(uuid, text, text, text) from public, anon;
grant execute on function public.recheck_compliance_rule(uuid, text, text, text) to authenticated;

-- ── 3 · CORRECTED, BY SOMEONE WHO MAY CORRECT IT ───────────────────────────────────────────────
-- Owners and admins: 0027's write policy, kept. Every field is what the authority said, and the
-- check that carries it says where. Clearing a deadline is allowed (lead_days null) — a rule with
-- no deadline is a real thing — but a basis with no number, or a number with no basis, is not.
create or replace function public.correct_compliance_rule(
  p_rule uuid, p_label text, p_link text, p_authority text, p_lead_days int, p_lead_basis text,
  p_checked_against text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  r public.compliance_rules%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  src text := btrim(coalesce(p_checked_against, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  lbl text := btrim(coalesce(p_label, ''));
begin
  if not public.is_admin() then raise exception 'only an owner or admin can correct a rule'; end if;
  if length(lbl) < 5 then raise exception 'the rule needs its words'; end if;
  if length(src) < 3 then
    raise exception 'say where you checked it — the county, the agency, the page or the person';
  end if;
  if (p_lead_days is null) <> (p_lead_basis is null) then
    raise exception 'a deadline needs both its number of days and whether they are business or calendar days';
  end if;
  if p_lead_basis is not null and p_lead_basis not in ('business', 'calendar') then
    raise exception 'business or calendar days';
  end if;
  if p_lead_days is not null and p_lead_days < 0 then raise exception 'a deadline cannot be negative'; end if;

  select * into r from public.compliance_rules
   where id = p_rule and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'that rule does not exist'; end if;

  insert into public.compliance_checks (rule_id, checked_on, checked_by, outcome, checked_against, note, before)
  values (r.id, today, auth.uid(), 'corrected', src, note,
          jsonb_build_object('label', r.label, 'link', r.link, 'authority', r.authority,
                             'lead_days', r.lead_days, 'lead_basis', r.lead_basis, 'verified', r.verified,
                             'verified_on', r.verified_on, 'check_note', r.check_note));

  update public.compliance_rules
     set label = lbl,
         link = nullif(btrim(coalesce(p_link, '')), ''),
         authority = nullif(btrim(coalesce(p_authority, '')), ''),
         lead_days = p_lead_days, lead_basis = p_lead_basis,
         verified = true, verified_on = today, verified_by = auth.uid(),
         check_note = 'Corrected ' || to_char(today, 'Mon FMDD, YYYY') || ' against ' || src || '.' || coalesce(' ' || note, '')
   where id = r.id;

  -- The report that asked for this correction has been answered.
  update public.alerts set ack_at = now()
   where kind = 'compliance_changed' and subject_id = r.id and ack_at is null;
  return 'corrected';
end $$;
revoke all on function public.correct_compliance_rule(uuid, text, text, text, int, text, text, text) from public, anon;
grant execute on function public.correct_compliance_rule(uuid, text, text, text, int, text, text, text) to authenticated;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A permit rule can be re-checked from the list that asks for it','improvement','Compliance',
   'Permit rules have carried the date someone last confirmed them since September, and the overdue ones appear under Needs you — but nothing in the app could record a new check, so they could never leave. Tapping one now opens the rule: what it says, who issues it, the page to check it against, and when it was last confirmed. Say where you checked and whether it still stands, and it is dated today. If the authority says something different, the rule is not rewritten by summary — it is marked unconfirmed with what was said and by whom, and an owner can correct its wording, link and deadline from the same place. Every check is kept.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0342_checked_with_whom_and_when',
  'compliance_checks (append-only from the app: written only by the two definer functions; staff read; tenant-stamped and isolated) + compliance_rules.verified_by. recheck_compliance_rule (staff): confirmed sets verified/verified_on (ET day)/verified_by and leaves v_obligations; changed never rewrites the rule — marks it unverified with what was said and by whom, and raises compliance_changed (alert_open_once) for the owners. correct_compliance_rule (admin, 0027''s write rule): label/link/authority/lead_days+basis from what the authority said, with where it was checked; acks the compliance_changed alert. "Where you checked" is required everywhere (>= 3 chars); a rule not active (an agent proposal awaiting approval) cannot be re-checked; each check keeps the rule as it stood before.');

-- verify:
--   select column_name from information_schema.columns where table_name = 'compliance_rules' and column_name = 'verified_by';   -- 1 row
--   select polname from pg_policy where polrelid = 'public.compliance_checks'::regclass order by 1;   -- compliance_checks_read, tenant isolation
--   select proname from pg_proc where proname in ('recheck_compliance_rule','correct_compliance_rule');   -- 2
--   select freshness, count(*) from public.v_compliance_freshness group by 1;   -- unchanged until someone checks one

-- ============================================================
-- 0343_a_pre_order_says_when_it_is_made.sql
-- ============================================================
-- ── A PRE-ORDER SAYS WHEN IT IS MADE ──────────────────────────────────────────────────────────
-- 2026-10-04. The last of Ryan's four ("All four, in order"): the customer side.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- Cup orders open four hours before a stop by default (live_status.preorder_lead_h, 0137; a stop
-- may set its own lead, 0191). An order placed at 7am for a stop that opens at 11 went in as an
-- ordinary order: the confirmation said "Ready in ~8 min", the email said "ready in ~8 min", and the
-- crew's pass aged it from 7am — so the truck opened to a red ticket three hours old and a banner
-- reading "1 guest past 8 min — step over and reassure", about a guest who had been told nothing
-- true and was not there yet. Nothing on the order said it had been placed ahead, so nothing could.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
-- orders.ready_from: when the truck said it would make this order. Null — the overwhelming case —
-- means as soon as it is in (the truck was pouring, or the stop was under way). A time means it was
-- placed ahead of a stop and is made from that stop's start; /api/checkout writes it from the same
-- rule the menu showed the customer (lib/ordering), and the app reads it in three places:
--   · the confirmation screen and email say "We make it when we open — Sat at 11:00am";
--   · the member's order bar says the same instead of "Order received";
--   · the pass shows the ticket as "for 11:00am" until then and ages it from 11, not from 7.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
-- No constraint ties it to created_at: the server's clock and the database's are not the same
-- clock, and an order the database refused over a few seconds of skew — after the card was charged
-- — would be the worst possible outcome of a column that only informs. It does not attribute an
-- order to the stop it was placed for: orders.stop_id is still stamped from the live stop only
-- (0219), so an order placed ahead counts toward no stop in the reports, exactly as before. That is
-- a reporting restatement of its own, not a side effect of this one.
--
-- Until this is applied the app writes orders without the column (lib/deploySkew.writeAcrossSkew,
-- the one column named) and every reader treats its absence as null — which is today.

alter table public.orders add column if not exists ready_from timestamptz;

comment on column public.orders.ready_from is
  'When the truck said it would make this order. Null = as soon as it is in. A time = placed ahead of a stop (lib/ordering, state ahead) and made from that stop''s start; the pass ages it from then and the customer was told so. Written by /api/checkout only.';


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Ordering says when the truck is open, and when your order is made','improvement','Ordering',
   'The front page, the menu, the drink sheet, checkout and the server now answer "can I order a cup?" with one rule, so the screen can no longer offer what Pay then refuses. When the truck is closed they say when cup orders open instead of offering a pre-order. Checkout shows where to pick up, and an order placed before a stop opens says it will be made when the truck opens — on the confirmation, in the email, and on the crew''s pass, which no longer counts it late before the truck has opened. The scan-to-order code on the truck''s screen opens the menu, and the welcome screen is kept for people who come in through the front door.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0343_a_pre_order_says_when_it_is_made',
  'orders.ready_from timestamptz (nullable, no default, no constraint): when the truck said it would make the order — null = as soon as it is in; a time = placed ahead of a stop and made from its start. Written only by /api/checkout from lib/ordering (the same rule and read the phone uses: market_live, the stop''s own lead, the hour-before-close rule). Read by the confirmation, the member order bar and the pass (ages a ticket from ready_from when later than created_at). Attribution untouched: orders.stop_id still comes from the live stop (0219).');

-- verify:
--   select column_name, data_type, is_nullable from information_schema.columns where table_name = 'orders' and column_name = 'ready_from';   -- ready_from | timestamp with time zone | YES
--   select count(*) filter (where ready_from is not null) from public.orders;   -- 0 until someone orders ahead of a stop
