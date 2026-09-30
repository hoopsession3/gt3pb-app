-- ── THE ORDER THE APP COULD NOT SEND ──────────────────────────────────────────────────────────
-- 2026-09-30, 02:40. Ryan fixed the default payment method at Apliiq. The first flagship cap is
-- paid, real, ready to be made, and sitting in the crew queue — and this app has no way to send it.
--
-- submitOrderToApliiq is called from exactly ONE place in the codebase: app/api/shop/checkout, at
-- the moment of payment. There is no re-submit route and no crew button. The status text for
-- needs_fulfillment has been saying "Submit it by hand" since 0313, and it meant that literally:
-- open Apliiq's dashboard and type the order in yourself.
--
-- That is worse than tedious, because of how their shipping callback finds the order again:
--
--     /api/apliiq/fulfillment → .or(`id.eq.${external_id}, apliiq_order_id.eq.${apliiqOrderId}`)
--
-- external_id only exists if the order went through the API. apliiq_order_id is null until one
-- comes back. So an order typed in by hand matches NEITHER key: when Apliiq ships it the callback
-- 404s, no fulfillment row is written, the status never reaches 'shipped', and the customer never
-- gets the tracking email. Doing it by hand quietly costs the customer the one message they are
-- actually waiting for.
--
-- ── WHY THIS IS A MIGRATION AND NOT JUST A BUTTON ──────────────────────────────────────────────
-- Because pressing a button twice must not make two caps.
--
-- Submitting is not idempotent at Apliiq's end — it is an order placed against a card. Two clicks,
-- a double-tap, an impatient retry on a slow response, or two crew on two phones, and the business
-- has paid twice and made two garments for one sale. The check cannot live in the route: two
-- requests read "no apliiq id yet" at the same moment and both proceed. It has to be one atomic
-- write that only one caller can win, which means it has to be here.
--
-- 0334 already made the LIE unrepresentable (submitted requires an id). This makes the DOUBLE
-- unrepresentable.
alter table public.shop_orders add column if not exists apliiq_submit_started_at timestamptz;

comment on column public.shop_orders.apliiq_submit_started_at is
  'When a submit to Apliiq was last CLAIMED, not completed. The claim is what stops two clicks from placing two orders against the card — submitting is not idempotent at their end. Stale claims expire (see claim_shop_order_for_submit) because a lock with no expiry is an outage: a crashed attempt would wedge a paid order forever.';

-- ── THE CLAIM ──────────────────────────────────────────────────────────────────────────────────
-- Returns 'ok' when the caller may proceed, or a sentence saying why not — refusals are shown to a
-- person, so they say what happened rather than returning false.
--
-- ONE atomic UPDATE. Every condition is in the WHERE clause, so Postgres decides the winner; there
-- is no read-then-write gap for a second click to slip through.
-- p_tenant is NOT decoration and NOT optional. The route holds the service key, which bypasses
-- RLS, so tenancy is app-enforced here (R-002, the other half of 0134). Without it a staff member
-- of one tenant could hand this the id of ANOTHER tenant's order and have it placed at the
-- printer and charged to this deployment's account. An id-keyed access is narrower than a table
-- scan, but the id still has to be PROVEN to belong to the caller rather than assumed — that is
-- the IDOR shape, and it does not need a second tenant to exist before it is wrong.
drop function if exists public.claim_shop_order_for_submit(uuid, int);   -- the unscoped first cut
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

  update public.shop_orders
     set apliiq_submit_started_at = now()
   where id = p_order
     and tenant_id = p_tenant
     and apliiq_order_id is null
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

-- SERVICE ROLE ONLY, and that is the whole security model for this function. It does NOT check
-- is_staff(), because its one caller is /api/shop/resubmit, which holds the service key and has
-- already gated on staffFromRequest(). A function that skips the staff check and is reachable from
-- a browser would be a hole, so it is not reachable from one.
revoke all on function public.claim_shop_order_for_submit(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_shop_order_for_submit(uuid, uuid, int) to service_role;

comment on function public.claim_shop_order_for_submit(uuid, uuid, int) is
  'Atomically claim a paid order for submission to Apliiq, or explain in a sentence why not. Exists because submitting is NOT idempotent at Apliiq — it places an order against a card — so the "has this already gone?" check cannot live in a route where two requests can both read "no" before either writes. Service-role only: it deliberately does not check is_staff(), so it must never be reachable from a browser; the staff gate is in /api/shop/resubmit.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('You can send a paid order to the printer from the app','feature','Shop',
   'If an order did not reach the printer at checkout, the only way to fix it was to open the printer''s website and type the order in by hand — which also quietly broke the tracking email, because an order typed in there has nothing linking it back to the one in this app. There is now a "Send to printer" button on the order itself. It goes through the proper channel, so the shipping update finds its way home and the customer gets their tracking number, and it cannot be pressed twice into two caps.',
   '2026-09-30', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0335_the_order_the_app_could_not_send',
  'shop_orders.apliiq_submit_started_at + claim_shop_order_for_submit(), behind /api/shop/resubmit. submitOrderToApliiq had exactly one caller — checkout, at payment — so an order that missed the printer could only be placed by hand, which ALSO breaks /api/apliiq/fulfillment: it matches on external_id (API orders only) or apliiq_order_id (null until one returns), so a hand-typed order matches neither and the customer never gets tracking. The claim is a migration rather than a route check because submitting is not idempotent at Apliiq: two clicks would be two caps and two charges, and a read-then-write check in a route cannot prevent that. Claims expire so a crashed attempt cannot wedge a paid order forever. Service-role only and tenant-scoped; the staff gate is in the route. The first cut of this shipped three unscoped service-role accesses and failed the R-002 ratchet — an order id alone is not proof the caller owns it.');

-- verify:
--   select status, apliiq_order_id, apliiq_submit_started_at from public.shop_orders;
--   select public.claim_shop_order_for_submit('<order id>', '<tenant id>');      -- 'ok' the first time
--   select public.claim_shop_order_for_submit('<order id>', '<tenant id>');      -- refused: somebody is sending it
--   select has_function_privilege('authenticated', 'public.claim_shop_order_for_submit(uuid,uuid,int)', 'execute');  -- false
