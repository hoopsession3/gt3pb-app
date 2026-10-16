-- ── 0420 — MONEY MOVES THROUGH ITS OWN DOORS, AND IS COUNTED ON THE BUSINESS DAY ───────────────────────────────────
-- 2026-10-16. R10 of the customer audit — the 10/10 audit of the back end (Ryan, 2026-10-16: "then audit for 10/10 best
-- practices... front and back end"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Any crew role could rewrite money straight through the API: the policies on packs, deliveries, office orders and
--     invoices let every role but member update any column, and nothing stood between a page and `paid`, `total_cents`,
--     `payment_status` or an invoice's `amount_cents`. A pack set paid by hand showed paid, counted as revenue in Money
--     and was handed over; an office order was marked paid without the owner's check mark_invoice_paid has (0341). The
--     office board itself did it that way (components/OfficeOrders: two writes from the browser, and an invoice).
--   · "Covered" (0416) settled any unpaid cup or pack for free and counted it nowhere — the caller's own included.
--   · A delivery's ↩ Undo took the member's stamps for good: stepping back from Delivered clawed them, and marking it
--     delivered again could not award them twice. 0416 fixed exactly this for packs.
--   · Money's report and the founder digest counted UTC days (current_date, created_at::date): after 8 pm Eastern every
--     sale landed in tomorrow's bar and "7 days" began at 8 pm. And the day-by-day bars ran nine reads for every day.
--   · rsvps took a row from a signed-out page with no person on it ("anyone rsvp", 0009): the public "N going" count could
--     be pushed up at will, and the brew planner reads it as expected attendance.
--
-- WHAT.
--   · money_columns_guard — before a page (the API's authenticated role) writes a pack, a delivery, an office order or
--     an invoice: the money on it (paid, totals, payment ids and links, how and when it was collected, an invoice's
--     amount and status) changes only through a function of ours or the server — never a direct write — unless the
--     caller is an owner or admin. A page may not create one already settled. The work on them — stages, batches,
--     dates, pickups, the driver's outcomes, a cancel — writes as it always did.
--   · settle_office_order(order, 'paid' | 'invoiced') — the office board's settle, one door: owners and admins, the order
--     locked, from a state that still owes only, the invoice made in the same write; the order's payment link is the
--     route's to switch off (app/api/office/paylink), as before.
--   · staff_collect_payment (0416's): covered — a free cup or credit — is never the caller's own order or pack.
--   · award_points_delivery (0229's): Delivered awards once; a cancel gives it back; a step back keeps it (0416's rule).
--   · report_sales and founder_digest_alert (0417's): on the business day (business_day(), 0348) — the window starts at
--     Eastern midnight and each bar is an Eastern day — and the bars come from one grouped read, not nine a day.
--   · rsvps: a member's own, signed in ("member rsvp"); a status that is going, maybe or cancelled (new rows).
--     PART 2, for the SQL editor (it drops): "anyone rsvp".
-- existing rows: report_sales — reads only; past bars are said again on Eastern days the next time Money opens.
-- existing rows: founder_digest_alert — each digest is that day's snapshot ('fyi'); the next one counts Eastern days.
-- existing rows: award_points_delivery — writes the ledger only (no alert); stamps clawed by an Undo before this stay
--   clawed (the ledger is the record; an owner can re-award by hand).
-- changelog: below.

-- ── the money on an order changes through its own doors ─────────────────────────────────────────────────────────────
create or replace function public.money_columns_guard() returns trigger
  language plpgsql security invoker set search_path = public as $$
declare cols text[]; c text; o jsonb; n jsonb;
begin
  -- A function of ours runs as its owner and the server as service_role: only a page's own write is asked. Invoker on
  -- purpose — a definer would always see its owner here.
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    -- A page may not create one already settled.
    if coalesce((n ->> 'paid')::boolean, false)
       or coalesce(n ->> 'payment_status', '') in ('paid', 'invoiced', 'refunded')
       or n ->> 'collected_at' is not null
       or (tg_table_name = 'invoices') then
      raise exception 'Money on an order is recorded through its own door — an owner or admin can settle it.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  cols := case tg_table_name
    when 'drop_orders'     then array['paid', 'total_cents', 'payment_id', 'payment_status', 'collected_via', 'collected_at', 'collected_by', 'idempotency_key']
    when 'delivery_orders' then array['total_cents', 'bottle_subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'payment_status', 'payment_method', 'payment_id']
    when 'business_orders' then array['total_cents', 'subtotal_cents', 'delivery_fee_cents', 'tax_cents', 'price_per_gallon_cents', 'payment_status', 'payment_id', 'square_order_id', 'paylink_url', 'paylink_id']
    when 'invoices'        then array['amount_cents', 'status', 'paid_at', 'business_order_id', 'business_id']
    else array[]::text[] end;
  o := to_jsonb(old);
  foreach c in array cols loop
    if (n -> c) is distinct from (o -> c) then
      raise exception 'Money on an order changes through its own door — % is not a page''s to write. An owner or admin can settle it.', c
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.money_columns_guard() from public, anon, authenticated;
comment on function public.money_columns_guard() is
  'Before a page writes a pack, delivery, office order or invoice (0420): its money columns change only through a function of ours or the server, unless the caller is an owner or admin; a page may not create one already settled. Named a_… so it reads the row as the page sent it, before the triggers that derive payment_status.';

drop trigger if exists a_money_columns_guard on public.drop_orders;
create trigger a_money_columns_guard before insert or update on public.drop_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.delivery_orders;
create trigger a_money_columns_guard before insert or update on public.delivery_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.business_orders;
create trigger a_money_columns_guard before insert or update on public.business_orders
  for each row execute function public.money_columns_guard();
drop trigger if exists a_money_columns_guard on public.invoices;
create trigger a_money_columns_guard before insert or update on public.invoices
  for each row execute function public.money_columns_guard();

-- ── an office order settled, one door ──────────────────────────────────────────────────────────────────────────────
create or replace function public.settle_office_order(p_order uuid, p_how text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare o public.business_orders; v_invoice uuid;
begin
  if not public.is_admin() then
    raise exception 'Owners and admins settle office orders.' using errcode = '42501';
  end if;
  if p_how is null or p_how not in ('paid', 'invoiced') then
    raise exception 'Say how it was settled: paid or invoiced.' using errcode = '22023';
  end if;
  select * into o from public.business_orders
   where id = p_order and tenant_id = public.effective_tenant() for update;
  if not found then raise exception 'That order isn''t on the books.' using errcode = 'PT404'; end if;
  if o.canceled_at is not null then raise exception 'That order was canceled — nothing to settle.' using errcode = 'P0001'; end if;
  -- Settled already (a second tap, a second phone): said, not done twice.
  if o.payment_status not in ('pending', 'failed') then
    return jsonb_build_object('ok', true, 'already', o.payment_status);
  end if;
  update public.business_orders set payment_status = p_how where id = p_order;
  if p_how = 'invoiced' then
    insert into public.invoices (business_id, business_order_id, amount_cents, terms, status)
    values (o.business_id, o.id, o.total_cents, case when o.billing_terms = 'net30' then 'net30' else 'net15' end, 'open')
    returning id into v_invoice;
  end if;
  return jsonb_build_object('ok', true, 'payment_status', p_how, 'invoice', v_invoice);
end $$;
revoke all on function public.settle_office_order(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_office_order(uuid, text) to authenticated;
comment on function public.settle_office_order(uuid, text) is
  'The office board''s settle (0420): paid or invoiced, owners and admins only, the order locked, from pending or failed only (a second tap says it is settled already), and an invoice made in the same write. Its payment link is the route''s to switch off (app/api/office/paylink).';

-- ── covered is never your own ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.staff_collect_payment(p_kind text, p_id uuid, p_via text)
returns text language plpgsql security definer set search_path = public as $$
declare v_paid boolean; v_at timestamptz; v_gone boolean; v_owner uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_via is null or p_via not in ('cash', 'card_reader', 'covered') then
    raise exception 'say how it was paid: cash, card_reader or covered';
  end if;

  -- Cash sets paid (the till is counted nowhere else); the reader does not (Square counts it, 0341); covered — a free
  -- cup or the member's credit (0416) — does not either: it is owed nothing, and it is no money anywhere.
  if p_kind = 'cup' then
    select paid, collected_at, status = 'void', user_id into v_paid, v_at, v_gone, v_owner
      from public.orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that order does not exist'; end if;
    if v_gone then raise exception 'that order was voided — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    -- 0420: a free cup or credit for your own order is another crew member's to give (0392's rule for a card).
    if p_via = 'covered' and v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own order: another crew member settles it as covered' using errcode = '42501';
    end if;
    update public.orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  elsif p_kind = 'pickup' then
    select paid, collected_at, canceled_at is not null, user_id into v_paid, v_at, v_gone, v_owner
      from public.drop_orders where id = p_id and tenant_id = public.effective_tenant() for update;
    if not found then raise exception 'that pack does not exist'; end if;
    if v_gone then raise exception 'that pack was canceled — nothing to collect'; end if;
    if v_paid or v_at is not null then return 'already settled'; end if;
    if p_via = 'covered' and v_owner is not null and v_owner = auth.uid() then
      raise exception 'your own pack: another crew member settles it as covered' using errcode = '42501';
    end if;
    update public.drop_orders
       set paid = (p_via = 'cash'), collected_via = p_via, collected_at = now(), collected_by = auth.uid()
     where id = p_id;
    return 'collected';
  end if;
  raise exception 'unknown kind: %', coalesce(p_kind, 'null');
end $$;
revoke all on function public.staff_collect_payment(text, uuid, text) from public, anon, authenticated;
grant execute on function public.staff_collect_payment(text, uuid, text) to authenticated;

-- ── a delivery's stamps: a step back keeps them; a cancel gives them back (0416's rule for packs) ──────────────────────
create or replace function public.award_points_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.canceled_at is null and new.user_id is not null then
    perform public.credit_wallet(new.user_id, new.pack_size, new.total_cents, new.id, 'delivery');
  elsif new.canceled_at is not null and old.canceled_at is null and new.user_id is not null then
    -- Canceled: what it earned, if it earned anything, comes back (claw_wallet writes nothing for one never delivered).
    perform public.claw_wallet(new.user_id, new.id, 'delivery');
  end if;
  -- Delivered → back a step is a correction on the run (↩ Undo, components/DriverRun): the stamps stay; it can never
  -- double on the way back to delivered — the ledger awards an order once.
  return new;
end $$;

-- ── Money's report on the business day (0417's, the days Eastern) ─────────────────────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_day();
  first_day date := public.business_day() - (greatest(p_days, 1) - 1);
  -- 0420: the window opens at Eastern midnight of its first day (it opened at UTC midnight: 8 pm the evening before).
  since timestamptz := (first_day::timestamp at time zone 'America/New_York');
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint; resv bigint;
  sq_n bigint;
  rf_walk bigint; rf_cup bigint; rf_packs bigint; rf_deliv bigint; rf_office bigint;
  days jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
                and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done');
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                        from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid), 0)
          + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                        where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between first_day and today and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  resv   := coalesce((select sum(paid_cents - refunded_cents) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid), 0);
  select coalesce(sum(x.off_cents) filter (where x.channel = 'walkup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'cup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'packs'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'delivery'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'office'), 0)
    into rf_walk, rf_cup, rf_packs, rf_deliv, rf_office
    from public.refunds_counted(tid) x
   where x.made_at >= since;
  sq := sq - rf_walk; cup := cup - rf_cup; packs := packs - rf_packs; deliv := deliv - rf_deliv; office := office - rf_office;

  -- 0420: the bars — every amount above on the Eastern day it moved, read once and grouped (nine reads a day before).
  with money as (
    select (es.created_at at time zone 'America/New_York')::date as d, es.amount_cents::bigint as c
      from event_sales es
     where es.created_at >= since and es.tenant_id = tid
       and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
       and not exists (select 1 from drop_orders d2 where d2.payment_id = es.square_payment_id)
       and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
       and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
       and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
       and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
       and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')
    union all
    select (o.created_at at time zone 'America/New_York')::date, o.total_cents::bigint
      from orders o where o.paid and o.status <> 'void' and o.created_at >= since and o.tenant_id = tid
    union all
    select (d.created_at at time zone 'America/New_York')::date,
           (d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))::bigint
      from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid
    union all
    select (ch.created_at at time zone 'America/New_York')::date, ch.diff_cents::bigint
      from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
     where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid
    union all
    select (dv.created_at at time zone 'America/New_York')::date, dv.total_cents::bigint
      from delivery_orders dv where dv.payment_status = 'paid' and dv.canceled_at is null and dv.created_at >= since and dv.tenant_id = tid
    union all
    select b.delivery_date, b.total_cents::bigint
      from business_orders b where b.payment_status = 'paid' and b.canceled_at is null and b.delivery_date between first_day and today and b.tenant_id = tid
    union all
    select (sh.created_at at time zone 'America/New_York')::date, (sh.total_cents - coalesce(sh.refund_amount_cents, 0))::bigint
      from shop_orders sh where sh.status <> 'canceled' and sh.total_cents > 0 and sh.created_at >= since and sh.tenant_id = tid
    union all
    select (rc.created_at at time zone 'America/New_York')::date, (rc.paid_cents - rc.refunded_cents)::bigint
      from reserve_claims rc where rc.state in ('paid', 'collected') and rc.paid_cents is not null and rc.created_at >= since and rc.tenant_id = tid
    union all
    select (x.made_at at time zone 'America/New_York')::date, -x.off_cents
      from public.refunds_counted(tid) x where x.made_at >= since
  ), per_day as (
    select m.d, sum(m.c) as cents from money m group by m.d
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'MM-DD'), 'cents', coalesce(p.cents, 0)) order by g.day), '[]'::jsonb)
    into days
    from (select gs::date as day from generate_series(first_day, today, interval '1 day') gs) g
    left join per_day p on p.d = g.day;

  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop + resv,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop, 'reserve', resv),
    'refunds_cents', rf_walk + rf_cup + rf_packs + rf_deliv + rf_office,
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between first_day and today and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid),
      'reserve',  (select count(*) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid)),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    'cogs_basis', (select jsonb_build_object(
        'products', count(*),
        'costed',   count(*) filter (where m.costed),
        'assumed',  not exists (select 1 from products p
                                  join product_components pc on pc.product_id = p.id
                                  join inventory_items ii on ii.id = pc.inventory_item_id
                                 where p.price_cents > 0 and p.tenant_id = tid and ii.tenant_id = tid))
      from (select p.id,
                   exists (select 1 from product_components pc where pc.product_id = p.id)
                   and not exists (select 1 from product_components pc
                                     left join inventory_items ii on ii.id = pc.inventory_item_id
                                    where pc.product_id = p.id and (ii.unit_cost is null or pc.qty_per_serving is null)) as costed
              from products p where p.active and p.price_cents > 0 and p.tenant_id = tid) m),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where created_at >= since and tenant_id = tid
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
          and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', days
  );
end; $$;
revoke execute on function public.report_sales(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;

-- The founder digest's week, on the business day (0417's).
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text; back bigint;
  today date := public.business_day();
  since timestamptz := ((public.business_day() - 6)::timestamp at time zone 'America/New_York');
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from today) <> 1 then return; end if;

  for t in select id from public.tenants loop
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= since and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= since and tenant_id = t.id), 0)
         + coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                       from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = t.id), 0)
         + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                       where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and delivery_date between today - 6 and today and tenant_id = t.id), 0)
      into rev;
    select coalesce(sum(x.off_cents), 0) into back
      from public.refunds_counted(t.id) x
     where x.made_at >= since and x.channel in ('walkup', 'cup', 'packs', 'delivery', 'office');
    rev := rev - back;

    select count(*) into blockers from public.incident_log where resolved = false and severity = 'blocker' and tenant_id = t.id;
    select count(*) into reorders from public.alerts where ack_at is null and category = 'prep' and title like '📦 Reorder%' and tenant_id = t.id;
    select count(*) into crit     from public.alerts where ack_at is null and severity = 'critical' and tenant_id = t.id;
    select count(*) filter (where critical and status = 'blocked'), count(*) filter (where critical)
      into rdy_blocked, rdy_total from public.readiness_checks where tenant_id = t.id;
    verdict := case when rdy_total = 0 then 'no criteria yet' when rdy_blocked > 0 then 'NO-GO' else 'on track' end;

    msg := 'Revenue 7d: $' || to_char(rev / 100.0, 'FM999,999,990.00')
        || '  ·  Launch: ' || verdict || case when rdy_blocked > 0 then ' (' || rdy_blocked::text || ' blocked)' else '' end
        || '  ·  Blockers: ' || blockers::text
        || '  ·  Reorders: ' || reorders::text
        || '  ·  Needs you: ' || crit::text;

    insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
    values ('fyi', 'money', '📊 Daily founder digest', msg, '/admin', null, t.id);
  end loop;
end $$;
revoke execute on function public.founder_digest_alert() from public, anon, authenticated;
grant execute on function public.founder_digest_alert() to service_role;

-- ── an RSVP is a member's own ──────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "member rsvp" on public.rsvps;
create policy "member rsvp" on public.rsvps for insert to authenticated
  with check (user_id = (select auth.uid()));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rsvps_status_words') then
    alter table public.rsvps add constraint rsvps_status_words check (status in ('going', 'maybe', 'cancelled')) not valid;
  end if;
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Money on an order moves through its own doors', 'security', 'Money',
   'Whether a pack, a delivery or an office order is paid — and what an invoice is for — changes only through the app''s own steps (taking payment at the window, an owner settling an office order), never by a direct edit, and settling an office order is an owner''s or admin''s. A free cup or credit is never the crew member''s own order.',
   '2026-10-16', false),
  ('Money counts Eastern days', 'fix', 'Money',
   'Money''s report and the founder digest count the business day in Eastern time: a sale after 8 pm is that evening''s, not tomorrow''s, and "7 days" starts at midnight. The day-by-day bars load faster.',
   '2026-10-16', false),
  ('An Undo on a delivery keeps its stamps', 'fix', 'Loyalty',
   'Stepping a delivered order back on the driver''s run no longer takes the member''s stamps away for good; canceling a delivery still gives back what it earned.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ═════ PART 2 — for the SQL editor (it drops). Run after part 1, in the same paste or on its own. ═════════════════════
-- An RSVP is a member's own: the signed-out door goes.
drop policy if exists "anyone rsvp" on public.rsvps;

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'a_money_columns_guard';                                              -- 4
--   select has_function_privilege('authenticated', 'public.settle_office_order(uuid, text)', 'execute');                 -- true
--   select has_function_privilege('anon', 'public.settle_office_order(uuid, text)', 'execute');                          -- false
--   select prosrc like '%another crew member settles it as covered%' from pg_proc where proname = 'staff_collect_payment'; -- true
--   select prosrc like '%business_day()%' from pg_proc where proname = 'report_sales';                                   -- true
--   select prosrc like '%new.canceled_at is not null and old.canceled_at is null%' from pg_proc where proname = 'award_points_delivery'; -- true
--   select count(*) from pg_policies where tablename = 'rsvps' and policyname = 'anyone rsvp';                         -- 0
select public.record_migration('0420_money_moves_through_its_own_doors_and_is_counted_on_the_business_day');
