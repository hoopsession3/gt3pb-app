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
--
-- Each function is its latest definition (report_sales 0358, report_events 0220) with only the lines above changed.
-- Same signatures, same return types; the payloads gain a key and lose none. The app half ships in the same change
-- (lib/home names the shop's channel). Paste this before the deploy that reads it; pasted after, nothing breaks.
-- scripts/db.money.test.mjs runs this file against every migration before it and shows each finding first.
-- changelog: below.

-- ── 1 · report_sales: the shop is a channel ──────────────────────────────────────────────────────────────────────
-- 0358's function but the shop channel and the shop clause in both walk-up matches and in by_event.
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  sq     := coalesce((select sum(es.amount_cents) from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)), 0);
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
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
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
grant execute on function public.report_sales(int) to authenticated;

-- ── 2 · report_events: a shop payment joins no event ─────────────────────────────────────────────────────────────
-- 0220's function but the shop clause.
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct(); tid uuid := public.effective_tenant();
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(payload order by cents desc, sort_key) from (
    select jsonb_build_object(
        'id', e.id, 'kind', 'event',
        'event', e.title,
        'actual_cents', coalesce(s.cents, 0),
        'orders', coalesce(s.n, 0),
        'cogs_pct', coalesce(ec.cogs_pct, blended),
        'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
        'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct, blended)))
                        - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0))
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
        'margin_cents', round(so.cents * (1 - blended))
      ), so.cents, 100000::numeric
    from stops st
    join (select stop_id, sum(total_cents) cents, count(*) n from orders
            where paid and status <> 'void' and stop_id is not null and tenant_id = tid group by stop_id) so on so.stop_id = st.id
    where st.archived_at is null and st.tenant_id = tid
  ) all_rows), '[]'::jsonb);
end; $$;
grant execute on function public.report_events() to authenticated;

-- ── what changed ─────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The money numbers say what they are','fix','Money',
   'Shop and program sales are their own line in Sales instead of being counted as walk-ups, and one paid during an event no longer counts toward that event.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_sales';   -- t
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_events';  -- t
select public.record_migration('0384_the_money_numbers_are_honest',
  'report_sales: shop channel (shop_orders total less refunds, canceled out) and shop_orders in both walk-up matches and by_event; report_events: shop payments join no event.');
