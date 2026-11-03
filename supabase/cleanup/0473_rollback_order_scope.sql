-- 0473 · REOPENS THE CROSS-BUSINESS ORDER GAP — only for a proven defect in 0473's one-line business check on
-- set_shop_order_status, and only by its own decision. Not part of 0473_rollback.sql. Puts back 0417's body exactly
-- (an order found by its id alone, any business). Same signature and grants.
set lock_timeout = '5s';
begin;
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

commit;
reset lock_timeout;
