-- ── "SUBMITTED" MEANT THEY GAVE US AN ID. THEY DID NOT. ────────────────────────────────────────
-- 2026-09-30. 0329 rewrote what `submitted` means, because the old wording claimed the printer had
-- accepted an order this app had only ever POSTed. The new wording is careful:
--
--     submitted → "We sent it and Apliiq's API returned an id. That is the last thing this app
--                  knows — it is NOT acceptance."
--
-- Read out of production tonight, the only real order in this database:
--
--     status = 'submitted'      apliiq_order_id = NULL
--
-- No id was ever returned, or none was ever parsed. So the sentence written to stop this app
-- overstating itself is overstating itself, on the one order it was written about. Fourth time
-- tonight the same disease has turned up, and this is the one hiding inside the cure.
--
-- ── HOW A 2xx BECAME AN ACCEPTANCE ─────────────────────────────────────────────────────────────
-- lib/apliiq returned `{ ok: true; apliiqOrderId: string | null }` and checkout wrote the status on
-- `submit.ok` alone. An empty body, a renamed field, an HTML error page served with 200 — all of
-- them produced ok:true with a null id and a row that claimed the opposite. That type is fixed in
-- the same commit: success now REQUIRES the id, and a reply we cannot read goes to the crew queue
-- carrying its reason.
--
-- The id is not bookkeeping. /api/apliiq/fulfillment matches their callbacks on apliiq_order_id, so
-- a null one can never be joined — this order could not hear back even if Apliiq did something.
-- That is the Apliiq bug, the Square bug and the Resend bug again: state mirrored from outside with
-- nothing able to reconcile it.
--
-- ── THE WORSE ONE: A FAILURE WITH NO EXIT ──────────────────────────────────────────────────────
-- 0313's state machine lets `submitted` move to in_production, shipped, canceled or refunded. It
-- does NOT let it move back to needs_fulfillment — while the text on `submitted`, written the day
-- before, says this out loud:
--
--     "Their importer can refuse the order afterwards and tells the account owner by EMAIL,
--      which never reaches here."
--
-- That refusal is this state's documented failure mode. It is what Apliiq did to the first cap. And
-- the crew's only moves when the printer hands an order back were: claim it is in production, claim
-- it shipped, cancel it, or refund it. Three of those are lies and the fourth throws away a sale
-- that is still perfectly fulfillable by hand. A state machine that describes a failure and offers
-- no move for it is asking an operator to lie.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────────────────────────
-- It does not touch money. The $32 was collected and stays collected; refund_amount_cents is
-- untouched and no refund is implied. It does not cancel anything. It moves one order to the status
-- that is true of it — paid, and nobody can show the printer has it — so it appears in the crew
-- queue where somebody can act on it.

-- ── 1 · THE EXIT THE FAILURE MODE ALWAYS NEEDED ────────────────────────────────────────────────
-- Re-emitted whole from 0313 with one array changed, so the two copies of this rule (here and
-- lib/shopOrder.SHOP_FLOW) stay readable side by side. scripts/smoke.cjs now fails if they diverge.
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

-- ── 2 · THE ROW THAT CLAIMS SOMETHING IT CANNOT SHOW ───────────────────────────────────────────
-- Restated before the constraint below, because a migration that corrects a rule and not the rows
-- the rule already produced leaves the product broken in the way the migration was written to fix
-- — which is the whole subject of 0333, one migration ago.
--
-- Direct UPDATE rather than set_shop_order_status(): that function is security-definer and demands
-- is_staff(), and nobody is logged in during a migration. The move it would have made is the move
-- made here, and the audit trigger on shop_orders records it either way.
update public.shop_orders
   set status = 'needs_fulfillment',
       status_note = concat_ws(E'\n', nullif(btrim(coalesce(status_note, '')), ''),
         'Moved from "submitted" by 0334 on 2026-09-30. It had been submitted with no Apliiq order '
         || 'id, which is the one thing that status is defined to mean — so the app could not show '
         || 'the printer ever took it, and Apliiq''s own email said it could not be imported. The '
         || 'money was collected and is untouched. This order is paid and still needs making.'),
       status_changed_at = now(),
       updated_at = now()
 where status = 'submitted'
   and apliiq_order_id is null;

-- ── 3 · MAKE THE CLAIM UNREPRESENTABLE ─────────────────────────────────────────────────────────
-- Not a comment asking people not to do it. The status is DEFINED as "Apliiq returned an id", so a
-- row holding that status without one is not a bad value — it is a false statement, and the
-- database is where a false statement is cheapest to refuse.
--
-- Added VALID, deliberately. NOT VALID would let the migration pass while leaving whatever is
-- already wrong in place, and step 2 has just made the table clean; if it has not, this fails and
-- the whole migration rolls back, which is the correct outcome for "there is another one I did not
-- know about".
alter table public.shop_orders
  drop constraint if exists shop_orders_submitted_needs_provider_id;
alter table public.shop_orders
  add constraint shop_orders_submitted_needs_provider_id
  check (status <> 'submitted' or apliiq_order_id is not null);

comment on constraint shop_orders_submitted_needs_provider_id on public.shop_orders is
  'status=''submitted'' means "Apliiq''s API returned an id" (lib/shopOrder). Without the id that is a false statement, and a null id also makes the order unmatchable by /api/apliiq/fulfillment, which joins their callbacks on it. Production held exactly one such row on 2026-09-30 — the first flagship cap.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An order can no longer say the printer has it without proof','fix','Shop',
   'An order was marked "sent to printer" whenever the printer''s website answered at all — even when its reply contained no order number, which is the only thing that can later match their updates back to the order. The first cap sat in exactly that state: charged, marked sent, with nothing on file to show anyone had it. Orders like that now go to the "needs fulfilment" queue with the reason attached, the database refuses to store the claim without the order number, and an order the printer hands back can finally be moved back to the queue instead of being cancelled or quietly mislabelled.',
   '2026-09-30', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0334_submitted_meant_they_gave_us_an_id',
  'shop_orders gains a CHECK that status=''submitted'' requires apliiq_order_id, plus the submitted→needs_fulfillment move 0313 never had. Production held status=''submitted'' with a NULL apliiq_order_id: lib/apliiq returned ok:true with a nullable id and checkout wrote the status on ok alone, so any unreadable 2xx claimed acceptance — the exact overstatement 0329 rewrote this status to remove, on the one real order. A null id is also unjoinable by /api/apliiq/fulfillment, so the order could never hear back. The first cap is restated to needs_fulfillment with the reason on the row; no money is touched. The missing transition was named on the status itself the day before ("their importer can refuse the order afterwards") and had no exit, leaving the crew to claim production, claim shipping, cancel, or refund — three lies and a thrown-away sale.');

-- verify:
--   select status, apliiq_order_id, status_note from public.shop_orders;
--   -- must be needs_fulfillment, and no row may be submitted with a null id
--   insert into public.shop_orders (status, apliiq_order_id) values ('submitted', null);  -- must FAIL
--   select count(*) from public.shop_orders where status = 'submitted' and apliiq_order_id is null;  -- 0
