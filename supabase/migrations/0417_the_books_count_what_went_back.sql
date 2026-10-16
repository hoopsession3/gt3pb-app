-- ── 0417 — THE BOOKS COUNT WHAT WENT BACK; A PART REFUNDED KEEPS THE ORDER; AN UNCLEAR SEND IS CHECKED ────────────────
-- 2026-10-16. R9 of the customer audit — money (Ryan, 2026-10-16: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY.
--   · Money (report_sales, 0415) and the founder digest's week counted what came in and never what went back. A walk-up
--     sale refunded in Square, a pre-order paid on the card reader and refunded, a cup or a pack refunded after it was
--     handed over, a pack change's charge given back: each stayed in revenue. Square sends every refund to the books
--     (square_refunds, by its webhook, 0330); nothing read it there but the shop's drift check.
--   · A part of a shop order refunded (a $5 goodwill credit on a $32 cap not yet sent) ended the order: 'refunded' is
--     final (set_shop_order_status, 0334), so it left "waiting on us", Send to printer went away and nothing shipped for
--     the $27 kept. A second part could not be recorded at all, so Square's refund-mismatch alert could never clear.
--   · Send to printer (0335) treated a timeout, a 5xx or a reply with no order id as "not sent": the claim aged out in
--     two minutes and a second press could place a second cap — on the business card — when Apliiq had taken the first.
--   · An office payment link could not be switched off: its Square id was never kept (0221).
--
-- WHAT.
--   · refund_counts_against(refund, payment) — what a completed Square refund takes off, on the day it was made:
--       a cup still counted (paid, not void) — its drinks, never more (the tip is no revenue here);
--       a pack still counted (paid, not canceled), by its own charge or an applied change's;
--       a delivery or an office order still counted (paid, not canceled);
--       a payment no order of ours carries — walk-up money, where the sale was counted (a change never applied included).
--     Nothing for an order already out of the books (voided, canceled: its sale left with it), for the shop and the
--     Limited Reserve (each keeps its own account of what went back: refund_amount_cents, refunded_cents), or for the
--     refund a pack change made itself (0415 counts the change's difference on its day).
--   · refunds_counted(tenant) — each completed refund and what it takes off, a cup's refunds capped together at its
--     drinks (a $10 cup and $2 tip given back as $6 and $6 takes off $10).
--   · report_sales (0415's) and founder_digest_alert (0415's) take each refund off the channel it counts against, on its
--     day; report_sales says how much (refunds_cents).
--   · set_shop_order_status (0334's): a refund for less than what is left on the order is recorded — added to what went
--     back — and the order stays where it is; the refund that leaves nothing is the one that ends it. The amount is this
--     refund's; none given is all that is left.
--   · An unclear answer from the printer: shop_orders.apliiq_submit_unknown_at. The sending routes write it before the
--     order leaves and take it off when a clear answer comes, so a send stopped half way is one too. The claim (0335's)
--     refuses while it is set — the printer may have the order — until the crew says, on the order, what Apliiq shows
--     (shop_apliiq_checked: its order id, or "not there", which clears it to send again — never while a send is still
--     out). v_shop_orders (0407's) gains the send's two marks, at its end.
--   · business_orders.paylink_id — the Square id of an office payment link, so a cancel can switch it off.
-- changelog: below.

-- ── what a refund takes off, and from where ─────────────────────────────────────────────────────────────────────────
create or replace function public.refund_counts_against(p_refund_id text, p_payment_id text, out channel text, out cap integer)
  language plpgsql stable security definer set search_path = public as $$
declare o record; d record; x record;
begin
  channel := null; cap := null;
  if p_payment_id is null then return; end if;
  -- A pack change's own refund (a smaller pack, 0388): the change moved it, and 0415 counts the change's difference.
  if exists (select 1 from public.drop_order_changes ch, jsonb_array_elements(ch.refunds) rf
              where ch.state = 'done' and rf->>'refund_id' = p_refund_id) then return; end if;
  -- The shop and the Limited Reserve keep their own account of what went back.
  if exists (select 1 from public.shop_orders sh where sh.payment_id = p_payment_id)
     or exists (select 1 from public.reserve_claims rc where rc.payment_id = p_payment_id) then return; end if;
  select paid, status, total_cents into o from public.orders where payment_id = p_payment_id limit 1;
  if found then
    if coalesce(o.paid, false) and o.status <> 'void' then channel := 'cup'; cap := greatest(coalesce(o.total_cents, 0), 0); end if;
    return;
  end if;
  select dd.paid, dd.canceled_at into d from public.drop_orders dd
   where dd.payment_id = p_payment_id
      or exists (select 1 from public.drop_order_changes ch
                  where ch.drop_order_id = dd.id and ch.state = 'done' and ch.charge_payment_id = p_payment_id)
   limit 1;
  if found then
    if coalesce(d.paid, false) and d.canceled_at is null then channel := 'packs'; end if;
    return;
  end if;
  select payment_status, canceled_at into x from public.delivery_orders where payment_id = p_payment_id limit 1;
  if found then
    if x.payment_status = 'paid' and x.canceled_at is null then channel := 'delivery'; end if;
    return;
  end if;
  select payment_status, canceled_at into x from public.business_orders where payment_id = p_payment_id limit 1;
  if found then
    if x.payment_status = 'paid' and x.canceled_at is null then channel := 'office'; end if;
    return;
  end if;
  channel := 'walkup';   -- nothing of ours carries it: walk-up money, where its sale was counted
end $$;
revoke all on function public.refund_counts_against(text, text) from public, anon, authenticated;
comment on function public.refund_counts_against(text, text) is
  'What a completed Square refund takes off (0417): the channel it counts against — cup, packs, delivery, office, walkup — and for a cup the most it can (the drinks, not the tip). Null for an order already out of the books, the shop and the Limited Reserve (their own accounts) and a pack change''s own refund. The books'' own helper: report_sales and the founder digest.';

-- Each completed refund and what it takes off, once: a cup's refunds together never take off more than its drinks (the
-- tip is no revenue here) — a $10 cup and $2 tip given back as $6 and $6 takes off $10, never $12. Each refund takes off
-- what it adds under the cap, in the order they were made, so a day's sum and a week's agree.
create or replace function public.refunds_counted(p_tenant uuid)
returns table (refund_id text, made_at timestamptz, channel text, off_cents bigint)
language sql stable security definer set search_path = public as $$
  with rf as (
    select r.id::text as id, r.payment_id, coalesce(r.amount_cents, 0)::bigint as amt, r.created_at, c.channel, c.cap
      from public.square_refunds r cross join lateral public.refund_counts_against(r.id::text, r.payment_id) c
     where r.status = 'COMPLETED' and r.tenant_id = p_tenant and c.channel is not null
  )
  select rf.id, rf.created_at, rf.channel,
         case when rf.channel = 'cup'
              then greatest(least(sum(rf.amt) over w, rf.cap) - least(sum(rf.amt) over w - rf.amt, rf.cap), 0)
              else rf.amt end
    from rf
  window w as (partition by rf.payment_id order by rf.created_at, rf.id rows between unbounded preceding and current row)
$$;
revoke all on function public.refunds_counted(uuid) from public, anon, authenticated;
comment on function public.refunds_counted(uuid) is
  'Every completed Square refund of a tenant and what it takes off its channel (0417, refund_counts_against): a cup''s refunds capped together at its drinks. The books'' own helper: report_sales and the founder digest.';

-- ── Money's report: what came in, less what went back (0415's, the refunds added) ─────────────────────────────────────
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint; resv bigint;
  sq_n bigint;
  rf_walk bigint; rf_cup bigint; rf_packs bigint; rf_deliv bigint; rf_office bigint;
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
                -- 0415: an applied pack change's own charge is the pack's money — counted in packs, on the change's day.
                and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done');
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  -- 0415: a pack's money on the days it moved — at its reservation, its total less what its applied changes moved; at each
  -- applied change, what that change moved.
  packs  := coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                        from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= since and d.tenant_id = tid), 0)
          + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                        where ch.state = 'done' and ch.created_at >= since and d.paid and d.canceled_at is null and d.tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  resv   := coalesce((select sum(paid_cents - refunded_cents) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid), 0);
  -- 0417: what went back, on the day it went, from what it counts against.
  select coalesce(sum(x.off_cents) filter (where x.channel = 'walkup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'cup'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'packs'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'delivery'), 0),
         coalesce(sum(x.off_cents) filter (where x.channel = 'office'), 0)
    into rf_walk, rf_cup, rf_packs, rf_deliv, rf_office
    from public.refunds_counted(tid) x
   where x.made_at >= since;
  sq := sq - rf_walk; cup := cup - rf_cup; packs := packs - rf_packs; deliv := deliv - rf_deliv; office := office - rf_office;
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop + resv,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop, 'reserve', resv),
    -- 0417: what Square gave back in the window and the books took off (each channel above is net of its own).
    'refunds_cents', rf_walk + rf_cup + rf_packs + rf_deliv + rf_office,
    -- Each channel's orders under the same rule as its money, so an average never divides one channel by another's count.
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid),
      'reserve',  (select count(*) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid)),
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
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
          and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
             and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
             and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done'))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0)), 0)
               from drop_orders d where d.paid and d.canceled_at is null and d.created_at::date = g::date and d.tenant_id = tid)
          + (select coalesce(sum(ch.diff_cents), 0) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
               where ch.state = 'done' and ch.created_at::date = g::date and d.paid and d.canceled_at is null and d.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents - coalesce(refund_amount_cents, 0)), 0) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(paid_cents - refunded_cents), 0) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at::date = g::date and tenant_id = tid)
          -- 0417: what went back that day
          - (select coalesce(sum(x.off_cents), 0) from public.refunds_counted(tid) x where x.made_at::date = g::date) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;
revoke execute on function public.report_sales(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;

-- The founder digest's week (0415's, the refunds taken off the same way): kept for the machinery alone, as 0381 left it.
create or replace function public.founder_digest_alert() returns void
  language plpgsql security definer set search_path = public as $$
declare
  cadence text; t record; rev bigint; blockers int; reorders int; crit int;
  rdy_blocked int; rdy_total int; verdict text; msg text; back bigint;
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
               and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
               -- 0415: an applied pack change's charge is the pack's money (below), not walk-up money.
               and not exists (select 1 from drop_order_changes ch where ch.charge_payment_id = es.square_payment_id and ch.state = 'done')), 0)
         + coalesce((select sum(total_cents) from orders           where paid and status <> 'void' and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         -- 0415: a pack's money on the days it moved — its reservation (less what its applied changes moved), and each change.
         + coalesce((select sum(d.total_cents - coalesce((select sum(ch.diff_cents) from drop_order_changes ch where ch.drop_order_id = d.id and ch.state = 'done'), 0))
                       from drop_orders d where d.paid and d.canceled_at is null and d.created_at >= (current_date - 6)::timestamptz and d.tenant_id = t.id), 0)
         + coalesce((select sum(ch.diff_cents) from drop_order_changes ch join drop_orders d on d.id = ch.drop_order_id
                       where ch.state = 'done' and ch.created_at >= (current_date - 6)::timestamptz and d.paid and d.canceled_at is null and d.tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from delivery_orders  where payment_status = 'paid' and canceled_at is null and created_at >= (current_date - 6)::timestamptz and tenant_id = t.id), 0)
         + coalesce((select sum(total_cents) from business_orders  where payment_status = 'paid' and canceled_at is null and delivery_date between current_date - 6 and current_date and tenant_id = t.id), 0)
      into rev;
    -- 0417: what went back in the week, from the channels counted above (the digest has no shop or Limited Reserve line).
    select coalesce(sum(x.off_cents), 0) into back
      from public.refunds_counted(t.id) x
     where x.made_at >= (current_date - 6)::timestamptz and x.channel in ('walkup', 'cup', 'packs', 'delivery', 'office');
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
-- existing rows: founder_digest_alert — each digest is that day's snapshot ('fyi', never open work); the past ones stay as
-- they were said, and the next one counts the week this way.

-- ── a shop order: a part refunded keeps it (0334's, the refund made one of many) ──────────────────────────────────────
create or replace function public.set_shop_order_status(
  p_order uuid, p_status text, p_note text default null, p_refund_cents int default null)
returns public.shop_orders
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; legal text[]; amt int; left_cents int;
begin
  if not public.is_staff() then raise exception 'Only crew can move a shop order.'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found then raise exception 'That order no longer exists.'; end if;
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

-- ── an unclear send: the printer may have it ───────────────────────────────────────────────────────────────────────
alter table public.shop_orders add column if not exists apliiq_submit_unknown_at timestamptz;
comment on column public.shop_orders.apliiq_submit_unknown_at is
  'When a send to the printer got no clear answer — a timeout, a 5xx, a reply with no order id (0417). Apliiq may have the order: the claim refuses another send until the crew says what Apliiq shows (shop_apliiq_checked).';

create or replace function public.claim_shop_order_for_submit(
  p_order uuid, p_tenant uuid, p_stale_seconds int default 120)
returns text
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; got uuid;
begin
  if p_tenant is null then return 'No tenant on this request.'; end if;
  select * into o from public.shop_orders where id = p_order and tenant_id = p_tenant;
  -- Deliberately the same sentence as a genuinely missing order. Saying "that belongs to somebody
  -- else" would confirm the id exists, which is the question an IDOR probe is asking.
  if not found then return 'That order no longer exists.'; end if;

  -- Said before the claim is attempted so the refusal can name the real reason. The claim's own
  -- WHERE repeats every one of these — these messages are for the human, that is for correctness.
  if o.apliiq_order_id is not null then
    return 'Apliiq already has this order (' || o.apliiq_order_id || '). Sending it again would '
        || 'make a second cap and charge the card twice.';
  end if;
  if o.status not in ('paid', 'needs_fulfillment') then
    return 'An order that is ' || o.status || ' is not waiting to be sent to the printer.';
  end if;
  -- 0417: a send not answered yet (the route marks the order before it leaves), or one that got no clear answer —
  -- Apliiq may have it. Look there first, and say so on the order.
  if o.apliiq_submit_unknown_at is not null then
    if o.apliiq_submit_started_at >= now() - make_interval(secs => greatest(p_stale_seconds, 5)) then
      return 'Somebody is sending this order right now. Give it a moment and refresh before trying again.';
    end if;
    return 'The last send got no clear answer from Apliiq — they may already have this order. Check Apliiq, then '
        || 'say on the order whether it is there. Sending it again before that could make a second cap.';
  end if;

  update public.shop_orders
     set apliiq_submit_started_at = now()
   where id = p_order
     and tenant_id = p_tenant
     and apliiq_order_id is null
     and apliiq_submit_unknown_at is null
     and status in ('paid', 'needs_fulfillment')
     -- A LOCK WITH NO EXPIRY IS AN OUTAGE. If a submit dies mid-flight — the process is killed, the
     -- network drops — the claim must age out or this paid order can never be sent by anyone again.
     -- The window is deliberately longer than any plausible Apliiq round trip.
     and (apliiq_submit_started_at is null
          or apliiq_submit_started_at < now() - make_interval(secs => greatest(p_stale_seconds, 5)))
   returning id into got;

  if got is null then
    return 'Somebody is sending this order right now. Give it a moment and refresh before trying again.';
  end if;
  return 'ok';
end $$;
revoke all on function public.claim_shop_order_for_submit(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_shop_order_for_submit(uuid, uuid, int) to service_role;

-- What the crew found at Apliiq: its order id (the order is at the printer), or none (it is not there: send it again).
create or replace function public.shop_apliiq_checked(p_order uuid, p_apliiq_id text default null)
returns public.shop_orders language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; v_id text := nullif(btrim(coalesce(p_apliiq_id, '')), '');
begin
  if not public.is_staff() then raise exception 'Only crew can say what the printer has.' using errcode = '42501'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found or o.tenant_id is distinct from public.effective_tenant() then raise exception 'That order no longer exists.'; end if;
  if o.apliiq_order_id is not null then raise exception 'Apliiq already has this order (%).', o.apliiq_order_id; end if;
  if v_id is not null and v_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' then raise exception 'That doesn''t read as an Apliiq order id.'; end if;
  -- "Not there" while a send is still out is not known yet: its answer comes first (the route clears or keeps the mark).
  if v_id is null and o.apliiq_submit_unknown_at is not null
     and o.apliiq_submit_started_at >= now() - interval '120 seconds' then
    raise exception 'It is being sent to Apliiq right now — wait for its answer, then look again.';
  end if;
  update public.shop_orders
     set apliiq_order_id          = v_id,
         status                   = case when v_id is not null and status in ('paid', 'needs_fulfillment') then 'submitted' else status end,
         apliiq_submit_unknown_at = null,
         apliiq_submit_started_at = null,
         updated_at               = now()
   where id = p_order
   returning * into o;
  return o;
end $$;
revoke all on function public.shop_apliiq_checked(uuid, text) from public, anon, authenticated;
grant execute on function public.shop_apliiq_checked(uuid, text) to authenticated;

-- 0407's view, with the send's two marks appended (a view may only grow at its end): the order's panel shows a send
-- still out, or one waiting for the crew's check, in place of Send to printer.
create or replace view public.v_shop_orders with (security_invoker = on) as
select
  o.id, o.created_at, o.updated_at, o.status,
  o.customer_id, o.user_id,
  coalesce(nullif(btrim(c.name), ''), nullif(btrim(o.ship_name), ''), o.email, 'Guest') as who,
  o.email, o.ship_name, o.ship_address,
  o.subtotal_cents, o.total_cents, o.refund_amount_cents,
  o.payment_id, o.apliiq_order_id, o.benefit_code, o.note,
  o.status_note, o.status_changed_at, o.status_changed_by,
  i.item_count, i.unit_count, i.items, i.cost_cents,
  case when i.cost_cents is null then null
       else coalesce(o.total_cents, 0) - i.cost_cents end                       as margin_cents,
  f.carrier, f.tracking_number, f.tracking_url, f.shipped_at,
  (o.status in ('paid','needs_fulfillment','submitted'))                        as waiting_on_us,
  (o.status in ('in_production'))                                               as waiting_on_printer,
  (o.status = 'shipped')                                                        as waiting_on_carrier,
  (o.status in ('delivered','refunded','canceled'))                             as closed,
  floor(extract(epoch from (now() - o.created_at)) / 3600.0)::int                as age_hours,
  o.ship_by,
  (o.ship_by is null or public.business_day() >= public.prior_business_day(o.ship_by))  as ship_risk,
  -- 0417: a send still out (started in the last two minutes, marked before it left), or one with no clear answer.
  o.apliiq_submit_started_at,
  o.apliiq_submit_unknown_at
from public.shop_orders o
left join public.customers c on c.id = o.customer_id
left join lateral (
  select count(*)::int                                                     as item_count,
         coalesce(sum(si.qty), 0)::int                                     as unit_count,
         string_agg(si.qty::text || 'x ' || si.title, ', ' order by si.title) as items,
         nullif(sum(coalesce(si.cost_cents, 0) * si.qty), 0)::int          as cost_cents
    from public.shop_order_items si where si.order_id = o.id
) i on true
left join lateral (
  select mf.carrier, mf.tracking_number, mf.tracking_url, mf.shipped_at
    from public.merch_fulfillments mf where mf.order_id = o.id
   order by mf.shipped_at desc nulls last, mf.created_at desc limit 1
) f on true;
revoke all on public.v_shop_orders from anon;
grant select on public.v_shop_orders to authenticated;

-- ── an office payment link's own id ────────────────────────────────────────────────────────────────────────────────
alter table public.business_orders add column if not exists paylink_id text;
comment on column public.business_orders.paylink_id is
  'The Square id of this order''s payment link (0417), so a cancel — or a payment taken another way — can switch it off.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Money counts what went back', 'fix', 'Money',
   'Refunds made in Square now come off Money''s revenue — and the founder digest''s week — on the day they were made: a walk-up sale, a cup or pack refunded after it was handed over, a card-reader payment given back. An order voided or canceled was already out of the books, so its refund is not taken off twice.',
   '2026-10-16', false),
  ('A partial shop refund keeps the order open', 'fix', 'Shop',
   'Recording part of a shop order as refunded adds it to what went back and leaves the order where it is — still to make and send. Only the refund that leaves nothing ends it. And a send to the printer with no clear answer waits for the crew to check Apliiq before it can be sent again.',
   '2026-10-16', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%refunds_counted%' from pg_proc where proname = 'report_sales';                       -- true
--   select prosrc like '%refunds_counted%' from pg_proc where proname = 'founder_digest_alert';               -- true
--   select has_function_privilege('authenticated', 'public.refund_counts_against(text, text)', 'execute');   -- false
--   select prosrc like '%amt < left_cents%' from pg_proc where proname = 'set_shop_order_status';             -- true
--   select count(*) from information_schema.columns where table_name = 'shop_orders' and column_name = 'apliiq_submit_unknown_at'; -- 1
--   select count(*) from information_schema.columns where table_name = 'business_orders' and column_name = 'paylink_id';           -- 1
--   select count(*) from information_schema.columns where table_name = 'v_shop_orders' and column_name like 'apliiq_submit_%';     -- 2
--   select prosrc like '%being sent to Apliiq right now%' from pg_proc where proname = 'shop_apliiq_checked';  -- true
select public.record_migration('0417_the_books_count_what_went_back');
