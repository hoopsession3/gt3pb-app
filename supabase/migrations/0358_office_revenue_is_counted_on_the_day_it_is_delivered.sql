-- 0358 — OFFICE REVENUE IS COUNTED ON THE DAY IT IS DELIVERED. Paste into Supabase → SQL Editor → Run.
-- Idempotent.
--
-- Phase 2, part 1 of the B2B challenge report (2026-10-07, "GT3 Challenge Report — B2B and Adaptive
-- Layout": Scheduling — "a nightly job turns the rule into real deliveries six weeks ahead"). 0356
-- made office deliveries a week ahead, on purpose: every reader of office revenue dated an order by
-- created_at — for a generated delivery, the night the generator made it — and the crew's route
-- listed every open order. Six weeks of rows would have counted a prepaid client's revenue six weeks
-- early, dropped a pay-on-delivery client's out of every 7- and 30-day window (made 42 days before it
-- is paid), and buried next Monday under five more. So the readers move first, here, and the
-- horizon grows with them:
--
--   report_sales (Reports, and the money headline on the console) and founder_digest_alert count an
--   office order on its delivery day. Nothing else in either function changes.
--
--   all_orders (the KPI board, the month's goal, a customer's history in the CRM) shows an office
--   order once its day has come, dated that day: a delivery three weeks out is a plan, not an order
--   that happened. Every other channel reads as it did.
--
--   office_horizon() is 42 — the nightly run keeps six weeks of each program's deliveries, which is
--   what the client's agenda shows and changes (Phase 2, part 2).
--
-- The app's own readers (the console's office tile, the daily digest, the week review, the crew's
-- route and the client's page) move in the same change. Past office revenue moves only where an
-- order was made in one window and delivered in the next — at most a week, at 0356's horizon — and
-- production had no office orders when this was written.
--
-- changelog: below.

-- ── 1 · report_sales: the office line counts the delivery day ───────────────────────────────────
-- 0220's function verbatim but two lines: the office total and the office part of each day.
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  sq     := coalesce((select sum(es.amount_cents) from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)), 0);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales where created_at >= since and tenant_id = tid group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
grant execute on function public.report_sales(int) to authenticated;

-- ── 2 · the founder digest: the same, for its seven days ────────────────────────────────────────
-- 0220's function verbatim but one line.
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text;
begin
  select digest_cadence into cadence from public.live_status where id = 1;
  if cadence is null or cadence = 'off' then return; end if;
  if cadence = 'weekly' and extract(dow from now()) <> 1 then return; end if;

  for t in select id from public.tenants loop
    select coalesce((select sum(es.amount_cents) from event_sales es
             where es.created_at >= (current_date - 6)::timestamptz and es.tenant_id = t.id
               and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
               and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
               and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from drop_orders      where paid and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and delivery_date between current_date - 6 and current_date and tenant_id = t.id), 0)
      into rev;

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
-- existing rows: founder_digest_alert — each digest is that day's snapshot ('fyi', never open work); the past ones stay as they were said.

-- ── 3 · all_orders: an office order is an order once its day comes, dated that day ──────────────
-- 0341's view verbatim but the office branch's date and its one condition. Same columns, same order,
-- same types, so `create or replace` keeps every grant and every reader.
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
    total_cents, (delivery_date + time '12:00') at time zone 'UTC'
  from public.business_orders
  where delivery_date <= current_date;

-- ── 4 · six weeks ahead ──────────────────────────────────────────────────────────────────────────
create or replace function public.office_horizon() returns int
language sql immutable as $$ select 42 $$;
comment on function public.office_horizon() is 'How many days ahead office deliveries are generated: 42, six weeks (0358; 7 in 0356, until every reader counted office revenue by delivery day). One home: the nightly job, the crew''s button and a booking all read it.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Office revenue counts on the day it''s delivered','improvement','Money',
   'Office deliveries are now scheduled six weeks ahead, so every revenue figure counts an office order on the day it is delivered, not the night the schedule made it: Reports, the console''s revenue, the daily digest, the KPI board and the month''s goal. A delivery still weeks away is a plan — it shows on the office route and the client''s schedule, never as money already made.',
   '2026-10-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select public.office_horizon();                                                                    -- 42
--   select prosrc like '%delivery_date between since::date and current_date%' from pg_proc where proname = 'report_sales';   -- t
--   select prosrc like '%delivery_date between current_date - 6 and current_date%' from pg_proc where proname = 'founder_digest_alert';   -- t
--   select count(*) from public.all_orders where channel = 'office' and created_at > now() + interval '1 day';   -- 0
select public.record_migration('0358_office_revenue_is_counted_on_the_day_it_is_delivered',
  'report_sales and founder_digest_alert count office revenue by delivery_date; all_orders shows office orders once delivery_date <= current_date, dated noon UTC that day; office_horizon() 42.');
