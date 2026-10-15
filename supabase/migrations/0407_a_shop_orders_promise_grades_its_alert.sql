-- ── 0407 — A SHOP ORDER'S PROMISE GRADES ITS ALERT ────────────────────────────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "severity by promise" — the third of the crew's
-- database rules, one yes and one migration each. Ryan, 2026-10-15: a paid merch order has 5 business days to ship.
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A paid merch order still waiting on us was critical from its 24th hour, and stayed critical: its severity came
-- from the alert's kind, not from anything the business had promised (0329, 0340). Nothing recorded a ship-by date to
-- compare with. So a printer delay rang when it was raised, rang the owners again when nobody picked it up (0373), and
-- sat on the Pass as critical during service — for an order with days still in hand.
--
-- WHAT.
--   · shop_promise_days() — 5: business days, Monday to Friday, from the day an order is paid to the day it ships.
--   · shop_ship_by(paid) — that day, in the business's time (Eastern); prior_business_day(day) — the weekday before it.
--   · shop_orders.ship_by — written with the order (a trigger), and for every order already here from the day it was
--     placed: a promise is kept for each order, open or closed.
--   · v_shop_orders, appended: ship_by, and ship_risk — the business's today has reached the weekday before the promise
--     (one business day or less left), or passed it. Everything else in the view is 0328's.
--   · The stall watchdog grades by it. Waiting on us from the 24th hour, inside its promise: important — on the inbox and
--     pushed, never rung, never escalated (0373 escalates criticals only). At risk or past it: critical, and that turn is
--     news, so it rings once: the watchdog closes the important alert and opens a critical one. An open critical is never
--     turned down under someone reading it (0336's rule). The title says the promise ("ships by Wed, Oct 21", or
--     "promised Wed, Oct 21" once it has passed), and the link is the shop's queue in the Catalog, where it is now.
--
-- existing rows: shop_order_stall_watchdog — an open stalled-order critical for an order still inside its promise was
-- raised by the old rule and would go on ringing the owners; it is restated to important, once, here — then the
-- producer runs, and refreshes every open row's words.
-- changelog: below.

create or replace function public.shop_promise_days() returns int
  language sql immutable set search_path = public as $$ select 5 $$;
comment on function public.shop_promise_days() is
  'Business days (Monday to Friday) a paid merch order has to ship — Ryan, 2026-10-15 (0407). The stall watchdog grades its alert by it.';

create or replace function public.shop_ship_by(p_paid timestamptz) returns date
  language plpgsql stable set search_path = public as $$
declare
  d date := (coalesce(p_paid, now()) at time zone 'America/New_York')::date;
  n int := public.shop_promise_days();
begin
  while n > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n - 1; end if;
  end loop;
  return d;
end $$;
comment on function public.shop_ship_by(timestamptz) is
  'The day a merch order paid at this moment must ship by: shop_promise_days() business days after its Eastern day (0407).';

create or replace function public.prior_business_day(p_day date) returns date
  language plpgsql immutable set search_path = public as $$
declare d date := p_day - 1;
begin
  while extract(isodow from d) > 5 loop d := d - 1; end loop;
  return d;
end $$;

alter table public.shop_orders add column if not exists ship_by date;
update public.shop_orders set ship_by = public.shop_ship_by(created_at) where ship_by is null;

create or replace function public.shop_order_promises() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.ship_by is null then new.ship_by := public.shop_ship_by(coalesce(new.created_at, now())); end if;
  return new;
end $$;
drop trigger if exists shop_order_promises on public.shop_orders;
create trigger shop_order_promises before insert on public.shop_orders
  for each row execute function public.shop_order_promises();

-- 0328's view, with two columns appended (a view may only grow at its end).
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
  -- THE ONE LINE THAT CHANGED. `submitted` moves here: accepted by the printer is not in production,
  -- and it stays our job until they say otherwise. Everything else is 0313's, unaltered.
  (o.status in ('paid','needs_fulfillment','submitted'))                        as waiting_on_us,
  (o.status in ('in_production'))                                               as waiting_on_printer,
  (o.status = 'shipped')                                                        as waiting_on_carrier,
  (o.status in ('delivered','refunded','canceled'))                             as closed,
  floor(extract(epoch from (now() - o.created_at)) / 3600.0)::int                as age_hours,
  -- 0407: the promise, and whether today has reached the weekday before it.
  o.ship_by,
  (o.ship_by is null or public.business_day() >= public.prior_business_day(o.ship_by))  as ship_risk
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

-- ── the watchdog, graded ──────────────────────────────────────────────────────────────────────────────────────────────
-- 0340's, but for the grade, the promise in the title and the link. Its closing of an alert whose order stopped waiting
-- on us, its body per status, its one open alert per order, and its count of new ones are 0340's, unaltered.
create or replace function public.shop_order_stall_watchdog(stale_hours int default 24)
  returns int language plpgsql security definer set search_path = public as $$
declare
  r        record;
  was_open boolean;
  v_ago    text;
  v_title  text;
  v_body   text;
  v_sev    text;
  raised   int := 0;
begin
  -- AN ALERT ABOUT AN ORDER THAT IS NO LONGER STUCK IS NOT AN ALERT. Closed by the mechanism that
  -- raised it (ack_at, ack_by left null — 0258's way of saying no person did it), and first, so a
  -- row is never closed and reopened in the same run. "Not waiting on us" is the view's decision,
  -- not this function's: in production, at the printer, shipped, refunded, cancelled, or gone.
  update public.alerts a
     set ack_at = now()
   where a.kind = 'shop_order_stalled'
     and a.ack_at is null
     and not exists (select 1 from public.v_shop_orders o where o.id = a.subject_id and o.waiting_on_us);

  -- greatest(...,1) so a mistaken 0 cannot turn this into "alert on every order the moment it is paid".
  for r in
    select o.id, o.who, o.status, o.age_hours, o.total_cents, o.items, o.created_at, o.status_changed_at, o.ship_by, o.ship_risk
      from public.v_shop_orders o
     where o.waiting_on_us
       and o.age_hours >= greatest(stale_hours, 1)
     order by o.age_hours desc
  loop
    -- THE GRADE IS THE PROMISE (0407). Inside it, important: on the inbox, pushed, never rung. At risk or past it,
    -- critical — and the turn is news, so the important alert closes and a critical opens (it rings once). An open
    -- critical stays critical.
    v_sev := case when r.ship_risk then 'critical' else 'important' end;
    if v_sev = 'critical' then
      update public.alerts set ack_at = now()
       where kind = 'shop_order_stalled' and subject_id = r.id and ack_at is null and severity <> 'critical';
    end if;
    was_open := exists (select 1 from public.alerts a
                         where a.kind = 'shop_order_stalled' and a.subject_id = r.id and a.ack_at is null);

    v_ago := case when r.age_hours >= 1 then public.shop_age_words(r.age_hours) || ' ago' else 'just now' end;
    -- The title carries the AGE and the PROMISE, so it is rewritten on every run along with everything else —
    -- alert_open_once refreshes title, body and link together.
    v_title := r.who || ' paid $' || to_char(coalesce(r.total_cents, 0) / 100.0, 'FM999,999,990.00')
             || ' ' || v_ago || ' — still waiting on us · '
             || case when r.ship_by is null then 'no promise on record'
                     when r.ship_by < public.business_day() then 'promised ' || to_char(r.ship_by, 'Dy, Mon FMDD')
                     else 'ships by ' || to_char(r.ship_by, 'Dy, Mon FMDD') end;
    -- One sentence per status, in the shop panel's own words (lib/shopOrder.ts SHOP_STATUS_META —
    -- scripts/smoke.cjs fails if a status the view calls waiting-on-us has no branch here, or if a
    -- branch stops quoting that status's label). 0329 had one body for all three, and it said "this
    -- app sent it" about Paid and Needs-fulfilment orders too — the cap's own alert said it.
    v_body := coalesce(r.items, 'This order') || '. ' || case r.status
      when 'submitted' then
        'The shop shows it as "Sent, not confirmed": it went to Apliiq on '
        || to_char(coalesce(r.status_changed_at, r.created_at) at time zone 'America/New_York', 'Dy, Mon FMDD')
        || ' and nothing has come back since. Apliiq refuses an order by emailing the account owner — '
        || 'never this app — so open Apliiq and make sure it is really there.'
      when 'needs_fulfillment' then
        'The shop shows it as "Needs fulfilment": paid, and nothing shows the printer has it. Open '
        || 'the order and send it to the printer, or refund it.'
      when 'paid' then
        'The shop shows it as "Paid": the card cleared and nothing has gone to the printer. Open the '
        || 'order and send it to the printer, or refund it.'
      else
        'It is still waiting on us.'
    end;

    perform public.alert_open_once('shop_order_stalled', r.id, v_sev, 'order', v_title, v_body,
                                   '/crew?s=catalog&a=shoporders');
    if not was_open then raised := raised + 1; end if;
  end loop;
  return raised;
end $$;
revoke all on function public.shop_order_stall_watchdog(int) from public, anon, authenticated;
comment on function public.shop_order_stall_watchdog(int) is
  'ONE alert per merch order that v_shop_orders says is waiting on us and was paid at least stale_hours ago (default 24), graded by its promise (0407): important inside it, critical once the business''s today reaches the weekday before its ship-by date or passes it — the important one closed and a critical opened, so the turn rings once. Raised and refreshed through alert_open_once; closes its own alert when the order stops waiting on us.';

-- The open criticals the old rule raised for orders still inside their promise: important now, once (see the header).
-- The old rule's are told by their title, which never said a promise; a critical this rule raised says one, and is left
-- as it is — so a second run changes nothing.
update public.alerts a
   set severity = 'important'
  from public.v_shop_orders o
 where a.kind = 'shop_order_stalled' and a.ack_at is null and a.severity = 'critical'
   and a.title not like '% — still waiting on us · %'
   and o.id = a.subject_id and o.waiting_on_us and not o.ship_risk;
select public.shop_order_stall_watchdog(24);

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A merch order rings when its promise is at risk, not before', 'improvement', 'Service',
   'Every paid merch order now has a ship-by date, 5 business days from when it was paid. Waiting on us inside that, it is an important alert — on the inbox, never ringing during service. A business day before the date, or past it, it turns critical and rings once.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.shop_orders where ship_by is null;                                       -- 0
--   select count(*) from pg_trigger where tgname = 'shop_order_promises';                                -- 1
--   select count(*) from public.alerts where kind = 'shop_order_stalled' and ack_at is null and severity = 'critical'
--      and subject_id in (select id from public.v_shop_orders where not ship_risk);                     -- 0
select public.record_migration('0407_a_shop_orders_promise_grades_its_alert');
