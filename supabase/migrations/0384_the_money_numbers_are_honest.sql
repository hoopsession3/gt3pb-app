-- ── 0384 — THE MONEY NUMBERS ARE HONEST ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. Release 1 of the money audit, approved by the owner on 2026-10-11. Findings in what Money reads, all from
-- the code. Paste into Supabase → SQL Editor → Run. Idempotent: a second run changes nothing.
--
-- 1. A SHOP PAYMENT WAS A WALK-UP. report_sales counts a Square payment as a walk-up when it matches no app order's
--    payment id (0216, 0220). The match looked in orders, drop_orders, delivery_orders and business_orders and never in
--    shop_orders, and the webhook mirrors every completed Square payment into event_sales against whatever event is live
--    (app/api/square/webhook/route.ts, the payment.* branch). So every merch or program purchase counted as a walk-up,
--    and one paid while an event was live joined that event's takings: Sales' "Revenue by event" and the per-event P&L.
--    Now the shop is its own channel ('shop': each order's total less what was refunded, canceled orders out, as
--    v_shop_queue counts them), the walk-up match looks in shop_orders too, and a shop payment joins no event.
--    A SUBSCRIPTION'S PAYMENT STAYS A WALK-UP, because nothing stored can tell it from one. Square bills a subscription
--    through an invoice whose payment arrives through the same payment.* event as a sale at the window, and:
--      · event_sales keeps the payment id, the amount and the live event — not the payment's Square order id or customer;
--      · subscriptions keeps the Square subscription and card — no invoice, order or payment id;
--      · the webhook's invoice.payment_made branch writes the subscription's status and nothing about the payment;
--      · webhook_events holds the raw payloads for 30 days only (purge_webhook_events), so it cannot be the record.
--    Filing them needs the webhook to keep payment.order_id on event_sales and each paid invoice's order_id against its
--    subscription. Subscriptions are off until the owner switches them on (live_status.subscriptions_enabled, 0150).
--    And every channel now says how many orders it holds ('orders_by_channel'), so an average is a channel's revenue over
--    that channel's orders. Sales divided ALL revenue by CUP orders alone (components/Reports.tsx, order_count).
--
-- 2. AN ESTIMATE DID NOT SAY SO. cogs_pct is the menu's blended cost of goods (catalog_cogs_pct, 0216), and 30% when no
--    product has a recipe. report_sales now says what it rests on ('cogs_basis': the priced menu products, how many have
--    every ingredient costed — the COGS calculator's own test, lib/cogs drinkCogs — and whether the 30% was assumed), and
--    report_events marks the events with no saved costs ('costs_saved' false), whose net is the blend and nothing else.
--
-- 3. ANY CREW MEMBER COULD READ THE BOOKS. report_sales, report_events, report_snapshot, report_spend and
--    report_product_mix checked is_staff(), so every server, contractor, operator and event manager could call them for
--    revenue, margins, MRR, spend and budgets; and anon could call them through PUBLIC's grant, to be told 'unauthorized'.
--    The console gives Money to owners and admins (app/crew/page.tsx: sec === "money" && isAdmin); the database now
--    agrees: each checks is_admin() (role admin or owner, 0035), and EXECUTE is taken from PUBLIC and anon. Untouched,
--    because they were already right: product_economics and event_economics are admin-only (0028), and
--    product_economics_live reads them as the caller (0256). No server route calls a report (app/api has no
--    supabaseAdmin.rpc of one; the daily digest sums the tables itself). service_role keeps EXECUTE, as Supabase's
--    default privileges give it, and like any caller without an admin's session is answered 'unauthorized'.
--
-- 4. THE SNAPSHOT COUNTED EVERY BUSINESS. report_snapshot (0048) predates tenants and filtered by none: inventory value,
--    subscribers, MRR, members and repeat buyers summed every tenant's rows. It reads the caller's tenant now
--    (effective_tenant()), as report_sales, report_events and report_spend have since 0216.
--
-- Each function is its latest definition (report_sales 0358, report_events 0220, report_snapshot 0048, report_spend 0292,
-- report_product_mix 0231) with only the lines above changed. Same signatures, same return types; the payloads gain keys
-- and lose none. The app half ships in the same change: lib/reports, lib/home, lib/economics, components/Reports,
-- SnapshotReport, EventPnlReport, SpendBudget, HomeNumbers and the console's live event card. Paste this before
-- the deploy that reads it; pasted after, nothing breaks — the screens read the new keys when they are there.
-- scripts/db.money.test.mjs runs this file against every migration before it and shows each finding first.
-- changelog: below.

-- ── 1 · report_sales: the shop is a channel, every channel counts its orders, the margin says what it knows ───────
-- 0358's function but the shop channel, the shop clause in both walk-up matches and in by_event, orders_by_channel,
-- cogs_basis and is_admin().
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint;
  sq_n bigint;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop),
    -- Each channel's orders under the same rule as its money, so an average never divides one channel by another's count.
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid)),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    -- What cogs_pct rests on. 'costed' is the COGS calculator's test (every ingredient has a unit cost and a quantity);
    -- 'assumed' is catalog_cogs_pct's own fallback, 30%, taken when no priced product has a recipe at all.
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
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
             and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents - coalesce(refund_amount_cents, 0)), 0) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at::date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;

-- ── 2 · report_events: a shop payment joins no event, and an event says whether its costs were saved ────────────
-- 0220's function but the shop clause, 'costs_saved' and is_admin().
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct(); tid uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(payload order by cents desc, sort_key) from (
    select jsonb_build_object(
        'id', e.id, 'kind', 'event',
        'event', e.title,
        'actual_cents', coalesce(s.cents, 0),
        'orders', coalesce(s.n, 0),
        'cogs_pct', coalesce(ec.cogs_pct, blended),
        'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
        'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct, blended)))
                        - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0)),
        'costs_saved', (ec.event_id is not null)
      ) as payload, coalesce(s.cents,0) as cents, coalesce(e.sort, 0)::numeric as sort_key
    from events e
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where tenant_id = tid
                 and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
               group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null and e.tenant_id = tid
    union all
    select jsonb_build_object(
        'id', st.id, 'kind', 'stop',
        'event', '🚚 ' || st.name,
        'actual_cents', so.cents,
        'orders', so.n,
        'cogs_pct', blended,
        'fixed_cents', 0,
        'margin_cents', round(so.cents * (1 - blended)),
        'costs_saved', false
      ), so.cents, 100000::numeric
    from stops st
    join (select stop_id, sum(total_cents) cents, count(*) n from orders
            where paid and status <> 'void' and stop_id is not null and tenant_id = tid group by stop_id) so on so.stop_id = st.id
    where st.archived_at is null and st.tenant_id = tid
  ) all_rows), '[]'::jsonb);
end; $$;

-- ── 3 · report_snapshot: this business's rows, for its owners and admins ─────────────────────────────────────────
-- 0048's function but tid, a tenant filter on every table it reads, and is_admin(). subscription_plans carries no
-- tenant: it is the price list the active subscriptions are joined to.
create or replace function public.report_snapshot()
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'inventory', jsonb_build_object(
      'item_count', (select count(*) from inventory_items where tenant_id = tid),
      'value_cents', coalesce((select round(sum(coalesce(qty,0) * coalesce(unit_cost,0)) * 100)
                                 from inventory_items where coalesce(status,'On Hand') not in ('Returned','Consumed') and tenant_id = tid), 0),
      'low_stock', (select count(*) from inventory_items where qty is not null and reorder_point is not null and qty <= reorder_point and tenant_id = tid),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('cat', coalesce(category,'Uncategorized'), 'value_cents', round(v * 100)) order by v desc) from (
          select category, sum(coalesce(qty,0) * coalesce(unit_cost,0)) v from inventory_items
          where coalesce(status,'On Hand') not in ('Returned','Consumed') and tenant_id = tid group by category having sum(coalesce(qty,0) * coalesce(unit_cost,0)) > 0
        ) c), '[]'::jsonb)
    ),
    'subs', jsonb_build_object(
      'active',   (select count(*) from subscriptions where status = 'active' and tenant_id = tid),
      'past_due', (select count(*) from subscriptions where status = 'past_due' and tenant_id = tid),
      'paused',   (select count(*) from subscriptions where status = 'paused' and tenant_id = tid),
      'total',    (select count(*) from subscriptions where tenant_id = tid),
      'mrr_cents', coalesce((select round(sum(sp.price_cents * 365.0 / nullif(sp.period_days,0) / 12))
                               from subscriptions s join subscription_plans sp on sp.key = s.plan where s.status = 'active' and s.tenant_id = tid), 0),
      'by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'n', n) order by n desc) from (
          select plan, count(*) n from subscriptions where status = 'active' and tenant_id = tid group by plan
        ) p), '[]'::jsonb)
    ),
    'loyalty', jsonb_build_object(
      'members',          (select count(*) from profiles where tenant_id = tid),
      'points_out',       coalesce((select sum(points) from profiles where tenant_id = tid), 0),
      'buyers',           (select count(distinct user_id) from orders where status <> 'void' and user_id is not null and tenant_id = tid),
      'repeat_customers', (select count(*) from (
          select user_id from orders where status <> 'void' and user_id is not null and tenant_id = tid group by user_id having count(*) > 1
        ) r)
    )
  );
end; $$;

-- ── 4 · report_spend: owners and admins ──────────────────────────────────────────────────────────────────────────
-- 0292's function but is_admin().
create or replace function public.report_spend(p_month date default current_date, p_market text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mstart date := date_trunc('month', p_month)::date;
  mend   date := (date_trunc('month', p_month) + interval '1 month')::date;
  tid    uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;

  return jsonb_build_object(
    'month', to_char(mstart, 'YYYY-MM'),
    'market', p_market,
    'total_spent_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is null
         and tenant_id = tid and (p_market is null or market = p_market)), 0),
    'total_budget_cents', coalesce((
      select sum(b.monthly_limit_cents) from (
        select distinct on (category, market) category, market, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market)
           and effective_from <= mstart
         order by category, market, effective_from desc
      ) b), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.slug,
        'label', c.label,
        'budget_cents', coalesce(b.monthly_limit_cents, 0),
        'spent_cents',  coalesce(s.spent, 0)
      ) order by coalesce(s.spent, 0) desc, c.sort, c.slug)
      from public.spend_categories c
      left join (
        select distinct on (category) category, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market) and effective_from <= mstart
         order by category, effective_from desc
      ) b on b.category = c.slug
      left join (
        select category, sum(amount_cents) spent from expenses
         where spent_on >= mstart and spent_on < mend and voided_at is null
           and tenant_id = tid and (p_market is null or market = p_market)
         group by category
      ) s on s.category = c.slug
      where c.active or coalesce(s.spent, 0) > 0
    ), '[]'::jsonb),
    'voided_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is not null
         and tenant_id = tid and (p_market is null or market = p_market)), 0)
  );
end $$;

-- ── 5 · report_product_mix: owners and admins ────────────────────────────────────────────────────────────────────
-- 0231's function but is_admin(). Nothing in the app calls it today; it is a money report all the same.
create or replace function public.report_product_mix(p_days int default 30)
returns table (slug text, name text, qty bigint, revenue_cents bigint, has_estimates boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'owners and admins only'; end if;
  return query
  select oi.slug, max(coalesce(oi.name, oi.slug)) as name,
         sum(oi.qty)::bigint as qty,
         (sum(coalesce(oi.unit_price_cents, 0)::bigint * oi.qty))::bigint as revenue_cents,
         bool_or(oi.estimated) as has_estimates
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.paid = true
    and oi.tenant_id = public.effective_tenant()
    and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by oi.slug
  order by revenue_cents desc, qty desc;
end $$;

-- ── 6 · who may call them ────────────────────────────────────────────────────────────────────────────────────────
-- Closed to PUBLIC and anon, kept for the signed-in person (the check inside decides) and for the service role.
revoke execute on function public.report_sales(int) from public, anon, authenticated;
revoke execute on function public.report_events() from public, anon, authenticated;
revoke execute on function public.report_snapshot() from public, anon, authenticated;
revoke execute on function public.report_spend(date, text) from public, anon, authenticated;
revoke execute on function public.report_product_mix(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;
grant execute on function public.report_events() to authenticated, service_role;
grant execute on function public.report_snapshot() to authenticated, service_role;
grant execute on function public.report_spend(date, text) to authenticated, service_role;
grant execute on function public.report_product_mix(int) to authenticated, service_role;

-- ── what changed ─────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The money numbers say what they are','fix','Money',
   'Shop and program sales are their own line in Sales instead of being counted as walk-ups, and one paid during an event no longer counts toward that event. Each channel''s average order is its own revenue over its own orders — the average used to divide all revenue by cup orders alone. A margin says how much of the menu has a known cost, or that 30% is assumed, and an event''s net says it is an estimate and what it assumed. A panel that could not read its numbers says so, with Try again, instead of showing nothing or $0. Sales, the snapshot, the event P&L and spend are for owners and admins only, and the snapshot counts this business alone.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select proname, prosrc like '%public.is_admin()%' from pg_proc where proname in ('report_sales', 'report_events', 'report_snapshot', 'report_spend', 'report_product_mix') order by 1;   -- t ×5
--   select count(*) from pg_proc where proname like 'report\_%' and has_function_privilege('anon', oid, 'execute');      -- 0
--   select count(*) from pg_proc where proname like 'report\_%' and has_function_privilege('service_role', oid, 'execute');   -- 5
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_sales';   -- t
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_events';  -- t
--   select prosrc like '%''orders_by_channel''%' and prosrc like '%''cogs_basis''%' from pg_proc where proname = 'report_sales';     -- t
--   select prosrc like '%''costs_saved''%' from pg_proc where proname = 'report_events';                                       -- t
--   select prosrc like '%and tenant_id = tid%' from pg_proc where proname = 'report_snapshot';                         -- t
select public.record_migration('0384_the_money_numbers_are_honest',
  'report_sales: shop channel (shop_orders total less refunds, canceled out) and shop_orders in both walk-up matches and by_event, orders_by_channel, cogs_basis {products, costed, assumed}; report_events: shop payments join no event, costs_saved; report_snapshot: effective_tenant() on every table; all five report_* gate on is_admin(), EXECUTE revoked from public and anon, granted to authenticated and service_role.');
