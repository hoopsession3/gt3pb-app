-- 0313 — A PAID ORDER NOBODY CAN SEE (2026-09-07)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The architecture audit's first item, and the one with a paying customer standing behind it:
-- shop_orders is the only entity in this app with NO INTERFACE AT ALL. Not a thin one — none.
--
-- The storefront works end to end. /api/shop/checkout prices the cart server-side, charges the card,
-- writes the order, hands it to Apliiq, and mails the customer. Apliiq's webhook writes the tracking
-- and flips the row to shipped. Every part of that is sound. And there is no screen anywhere in the
-- crew console that lists a single one of those orders. Live right now: 506 products imported,
-- 6 published, 0 orders. The shop is OPEN. The first order that lands is invisible.
--
-- Read /api/shop/checkout's own failure path and it says this out loud:
--
--     "Apliiq submit failed … It's paid and queued — submit it by hand."
--
-- Queued where? The alert it raises carries subject_id = the order id and a link to /crew, which is
-- the top of a six-thousand-line page. There is no queue. The alert names a place that does not
-- exist. That is the audit's whole thesis in one route.
--
-- ── what the status column says, and what actually writes it ───────────────────────────────────
-- The 0271 check constraint allows eight statuses. Tracing every writer in the codebase:
--
--     paid              nothing writes it (checkout inserts needs_fulfillment directly)
--     needs_fulfillment checkout, on insert
--     submitted         checkout, after Apliiq accepts
--     in_production     NOTHING
--     shipped           the Apliiq fulfillment webhook
--     delivered         NOTHING
--     refunded          NOTHING
--     canceled          NOTHING
--
-- Four of eight are unreachable. They were written down as the shape of a life the app cannot
-- actually give an order. This migration is the missing half: a way for a person to move one, with
-- the rules of the move enforced in the database rather than in whichever screen calls it.
--
-- ── the money sentence, which this file will not blur ──────────────────────────────────────────
-- Marking an order 'refunded' here does NOT return anyone's money. Nothing in this app can — card
-- data never touches it, by design, and refunds live in Square (Money → Checkout & payments already
-- links there for exactly this reason). This is the same trap /api/orders/cancel fell into and had
-- to be corrected for: it told customers "your refund is on the way" when all it had done was raise
-- a staff alert. So set_shop_order_status records a refund as a FACT SOMEONE ASSERTS, demands they
-- say why, and stores who and when. The UI says the rest in plain words and puts the Square link
-- next to the button. A status is a claim about the world; it is not an act on it.

-- ── 1) WHAT A STATUS MOVE LEAVES BEHIND ────────────────────────────────────────────────────────
-- Today a status change is a bare column write: no who, no when, no why. About to hand that switch
-- to the crew, so it needs to record itself first.
alter table public.shop_orders
  add column if not exists status_note         text,
  add column if not exists status_changed_at   timestamptz,
  add column if not exists status_changed_by   uuid references auth.users(id),
  add column if not exists refund_amount_cents int;

alter table public.shop_orders drop constraint if exists shop_orders_refund_sane;
alter table public.shop_orders add constraint shop_orders_refund_sane
  check (refund_amount_cents is null or (refund_amount_cents >= 0 and refund_amount_cents <= total_cents));

-- A customer order table with no audit trail — found while looking for one. audit_row is
-- column-agnostic (it reads id/tenant_id out of jsonb), so it attaches to the item and fulfillment
-- tables too even though neither carries a tenant_id.
do $$
declare t text;
begin
  foreach t in array array['shop_orders','shop_order_items','merch_fulfillments'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;

-- ── 2) A REFUNDED ORDER STAYS REFUNDED ─────────────────────────────────────────────────────────
-- The failure this prevents, concretely: you refund an order in Square and mark it refunded here.
-- Nobody cancels it at Apliiq, so Apliiq prints and ships it anyway, and its webhook does
--     update shop_orders set status = 'shipped'
-- The refund fact is gone, and the row now says an order you gave the money back for is on its way.
--
-- This does NOT raise. Raising would 500 the webhook, Apliiq would retry it forever, and the
-- tracking row — which is real and worth keeping — would be lost with it. Instead the terminal
-- status holds and the late report is written where a person will read it. The Square webhook
-- learned the same rule in 0187 ("never let a delayed retry flip a refunded order back to paid");
-- this is that rule for the print-on-demand side, which never got it.
create or replace function public.guard_shop_order_terminal()
returns trigger language plpgsql as $$
begin
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;
  if old.status in ('refunded','canceled')
     and new.status is distinct from old.status
     and new.status not in ('refunded','canceled') then
    new.note := concat_ws(E'\n', nullif(btrim(coalesce(old.note,'')), ''),
      'Printer reported "' || new.status || '" on ' || to_char(now(), 'Mon FMDD') ||
      ', after this order was already ' || old.status || '. Status left as ' || old.status ||
      '; the tracking below is still real.');
    new.status := old.status;
  end if;
  return new;
end $$;

drop trigger if exists guard_terminal_shop_orders on public.shop_orders;
create trigger guard_terminal_shop_orders before update on public.shop_orders
  for each row execute function public.guard_shop_order_terminal();

-- ── 3) THE ONE WAY A PERSON MOVES AN ORDER ─────────────────────────────────────────────────────
-- The legal moves live here rather than in the screen, because a screen is one caller and the rule
-- has to hold for all of them. Same shape as the agreement state machine in 0309.
--
-- 'canceled' → 'refunded' is deliberately legal. Every shop order is charged before the row exists,
-- so cancelling one always leaves money that belongs to somebody else. An order that can be
-- cancelled and never refunded is a dead end with a customer's money sitting in it.
create or replace function public.set_shop_order_status(
  p_order uuid, p_status text, p_note text default null, p_refund_cents int default null)
returns public.shop_orders
language plpgsql security definer set search_path = public as $$
declare o public.shop_orders; legal text[]; amt int;
begin
  if not public.is_staff() then raise exception 'Only crew can move a shop order.'; end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  if p_status = o.status then raise exception 'That order is already %.', o.status; end if;

  legal := case o.status
    when 'paid'              then array['needs_fulfillment','submitted','canceled','refunded']
    when 'needs_fulfillment' then array['submitted','shipped','canceled','refunded']
    when 'submitted'         then array['in_production','shipped','canceled','refunded']
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
    amt := coalesce(p_refund_cents, o.total_cents);
    if amt <= 0 or amt > coalesce(o.total_cents, 0) then
      raise exception 'A refund has to be between 1 cent and the $% this order charged.',
        to_char(coalesce(o.total_cents, 0) / 100.0, 'FM999999990.00');
    end if;
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

revoke all on function public.set_shop_order_status(uuid, text, text, int) from public, anon;
grant execute on function public.set_shop_order_status(uuid, text, text, int) to authenticated;

comment on function public.set_shop_order_status(uuid, text, text, int) is
  'Move a shop order through its life, with the legal moves enforced here rather than in a screen. Marking one refunded records that a refund WAS MADE — it does not make one. The card never touches this app; the money moves in Square.';

-- ── 4) THE ORDER, WHOLE ────────────────────────────────────────────────────────────────────────
-- security_invoker (0312's rule, one migration old): this honours shop_orders' own RLS, which since
-- 0271 says a customer sees their own orders and staff see all. So the same view can serve a
-- customer-facing "my orders" screen later without a second query being written for it — and, more
-- to the point, it does not hand the whole order book to anyone with a login.
--
-- margin_cents is null, not total_cents, when no line carries a cost. A margin computed from an
-- unknown cost is not a conservative estimate, it is a wrong number that looks like a right one.
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
  (o.status in ('paid','needs_fulfillment'))                                    as waiting_on_us,
  (o.status in ('submitted','in_production'))                                   as waiting_on_printer,
  (o.status = 'shipped')                                                        as waiting_on_carrier,
  (o.status in ('delivered','refunded','canceled'))                             as closed,
  floor(extract(epoch from (now() - o.created_at)) / 3600.0)::int                as age_hours
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

create or replace view public.v_shop_order_items with (security_invoker = on) as
select si.id, si.order_id, si.product_id, si.title, si.variant, si.qty,
       si.unit_cents, si.cost_cents,
       (si.qty * si.unit_cents)                                            as line_cents,
       case when si.cost_cents is null then null else si.qty * si.cost_cents end as line_cost_cents,
       p.image_url, p.apliiq_product_id,
       (p.id is not null and p.archived_at is not null)                    as product_archived,
       -- NOT "the product row is missing". shop_order_items.product_id is `on delete set null`
       -- (0271), so deleting a product does not orphan the line — it unlinks it, and the join can
       -- never see a dangling id. The first version of this column tested for the dangling case and
       -- was therefore permanently false; the test caught it because it deleted a real product
       -- instead of imagining one. What the crew needs is "no catalog product behind this line any
       -- more", which is exactly this. The title, price and cost on the line survive either way,
       -- which is the point of copying them onto the order at checkout.
       (si.product_id is null)                                             as product_unlinked
  from public.shop_order_items si
  left join public.shop_products p on p.id = si.product_id;

revoke all on public.v_shop_order_items from anon;
grant select on public.v_shop_order_items to authenticated;

-- The number the crew screen leads with, and the one the audit says should have existed before the
-- shop was switched on: how many orders are waiting on US, and how long has the oldest been waiting.
create or replace view public.v_shop_queue with (security_invoker = on) as
select
  count(*)::int                                                as orders,
  count(*) filter (where waiting_on_us)::int                   as on_us,
  count(*) filter (where waiting_on_printer)::int              as on_printer,
  count(*) filter (where waiting_on_carrier)::int              as on_carrier,
  count(*) filter (where closed)::int                          as closed,
  coalesce(sum(total_cents) filter (where status <> 'canceled'), 0)::bigint as gross_cents,
  coalesce(sum(refund_amount_cents), 0)::bigint                as refunded_cents,
  max(age_hours) filter (where waiting_on_us)                  as oldest_on_us_hours
from public.v_shop_orders;

revoke all on public.v_shop_queue from anon;
grant select on public.v_shop_queue to authenticated;

comment on view public.v_shop_orders is
  'One row per storefront order, with the customer, the line summary, the live tracking and who the order is waiting on. Before 0313 nothing in the crew console could show a shop order at all.';

-- ── 5) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Shop orders have a screen — and a life','feature','Money',
   'A customer could buy merch, get charged, get a confirmation email and get their tracking — and nobody on the crew could look at the order, because the shop had no interface at all. It has one now: a queue that leads with what is waiting on us and how long it has been waiting, every order openable in full with its items, its shipping address, its margin and its tracking. The status list always had eight stages; four of them were unreachable because nothing could write them. An order can now be submitted, marked in production, delivered, cancelled or refunded by a person, the legal moves are enforced in the database rather than in the screen, and cancelling or refunding one requires a reason that gets stored with who did it and when.',
   '2026-09-07', true),
  ('A refunded order stays refunded','fix','Money',
   'If an order was refunded and the print-on-demand partner shipped it anyway, their automatic update would have overwritten the refund and left the record saying the order was on its way. The refund now holds, the late shipping report is written onto the order where it can be read, and the tracking is still kept. The order screen also says plainly that marking a refund records it rather than issues it — the money moves in Square, and the link to do it sits next to the button.',
   '2026-09-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0313_a_paid_order_nobody_can_see',
  'v_shop_orders / v_shop_order_items / v_shop_queue; set_shop_order_status with enforced transitions and a mandatory reason on refund/cancel; terminal guard so a late Apliiq webhook cannot resurrect a refunded order; audit triggers on the three shop tables.');

-- verify:
--   select * from public.v_shop_queue;
--   select who, status, items, total_cents, age_hours, waiting_on_us from public.v_shop_orders order by created_at desc;
--   select public.set_shop_order_status('<id>','refunded');            -- refuses: no reason
--   select public.set_shop_order_status('<id>','delivered','...');     -- refuses: illegal from paid
--   select tgname from pg_trigger where tgrelid = 'public.shop_orders'::regclass and not tgisinternal;
