-- ── 0400 — A LIMITED RESERVE IS PAID TO HOLD ───────────────────────────────────────────────────────────────────────
-- 2026-10-14 (R5 of the customer audit — "Limited Reserve: pay to hold"; decided 2026-10-13: charged like packs, no
-- timer, a full refund on a cancel before the cutoff).
--
-- WHY. A Limited Reserve was a hold: claim_reserve (0014) took a bottle off the shelf for 48 hours and the member paid at
-- the truck. Nothing said where or when to come for it, the hold ran out on its own clock whether they meant to come or
-- not, and on the day the crew had no list of who was owed a bottle.
--
-- WHAT.
--   · reserves.stop_id — the pickup a reserve is handed over at, a stop on the schedule. Without one a reserve is
--     "opening soon": it cannot be paid for until the crew names its pickup.
--   · a reserve is paid for to be held, the way a pack is (lib/chargeOnce, under the checkout's own key): a claim is
--     pending while Square is asked, paid once it answers, collected when the crew hands the bottles over. It is the
--     member's until then — no timer. A cancel before the pickup closes (24 hours before the stop, the pack rule) is
--     refunded in full; after that it is the crew's call. On reserve_claims:
--       idempotency_key   the checkout key it was paid under (one claim per key)
--       payment_id        Square's payment (one claim per payment)
--       paid_cents        what was charged · refunded_cents  what went back (never more than was paid)
--       canceled_at, cancel_reason · collected_at, collected_by
--   · hold_reserve(user, reserve, qty, key) — the server's: the bottles come off the shelf as a pending claim, under the
--     key, once the reserve says yes: on offer, its pickup neither called off nor closed, members only where it says so,
--     within the member's limit, in stock. The same key again is the same claim.
--   · settle_reserve(claim, payment, cents), release_reserve(claim, reason, refunded) — the server's: pending to paid;
--     pending or paid to cancelled, the bottles back on the shelf.
--   · collect_reserve_claim(claim) — the crew's: paid to collected, by whom and when.
--   · reserve_closes_at(reserve) — when its pickup closes: 24 hours before its stop; null with no stop or a stop called
--     off (it cannot be paid for then).
--   · the crew read every claim — the day's list, a reserve's own; a reserve with a claim pending or paid is not taken
--     down (draft or archived) until the bottles are handed over or refunded.
--   · a refund made in Square finds its claim (0390's square_refunds, channel 'reserve'): all of it back releases a paid
--     claim; a part is kept on the claim.
--   · the books: report_sales counts what reserves took in, less refunds, as their own channel; a reserve's payment is
--     not walk-up money, nor an event's (report_events).
--   · claim_reserve is no longer the members' — a hold paid at the truck is gone. Holds already made run out as before.
--   · user_id may be empty: an erased account's claims stay in the books without it (0353).
--
-- ORDER. Deploy first, then paste this. Until it is here the page shows a reserve as opening soon, the pay route says
-- reserving by card is not switched on yet, and the crew's lists read the claims they always could.
-- existing rows: a claim marked paid by hand at the truck (no payment, no amount) was handed over then — collected.
-- A second run changes nothing.

-- ── the pickup ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.reserves add column if not exists stop_id uuid references public.stops (id) on delete set null;
create index if not exists reserves_stop on public.reserves (stop_id);
comment on column public.reserves.stop_id is
  'The pickup this reserve is handed over at (0400). None: opening soon — it cannot be paid for yet.';

-- ── a claim that is paid for ───────────────────────────────────────────────────────────────────────────────────────
alter table public.reserve_claims add column if not exists idempotency_key text;
alter table public.reserve_claims add column if not exists payment_id text;
alter table public.reserve_claims add column if not exists paid_cents integer;
alter table public.reserve_claims add column if not exists refunded_cents integer not null default 0;
alter table public.reserve_claims add column if not exists canceled_at timestamptz;
alter table public.reserve_claims add column if not exists cancel_reason text;
alter table public.reserve_claims add column if not exists collected_at timestamptz;
alter table public.reserve_claims add column if not exists collected_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reserve_claims_cents_check') then
    alter table public.reserve_claims add constraint reserve_claims_cents_check
      check (coalesce(paid_cents, 0) >= 0 and refunded_cents >= 0 and refunded_cents <= coalesce(paid_cents, 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reserve_claims_collected_by_fkey') then
    alter table public.reserve_claims add constraint reserve_claims_collected_by_fkey
      foreign key (collected_by) references auth.users (id) on delete set null;
  end if;
end $$;

alter table public.reserve_claims drop constraint if exists reserve_claims_state_check;
alter table public.reserve_claims add constraint reserve_claims_state_check
  check (state in ('held', 'pending', 'paid', 'collected', 'expired', 'cancelled'));

create unique index if not exists reserve_claims_key on public.reserve_claims (idempotency_key) where idempotency_key is not null;
create unique index if not exists reserve_claims_payment on public.reserve_claims (payment_id) where payment_id is not null;
-- A member may hold more than one claim on a reserve now ("Reserve another"); their limit is the sum (hold_reserve).
drop index if exists public.one_active_claim_per_member;

-- The books keep a claim when its member's account goes (0353): the link to the account is let go, not the row.
alter table public.reserve_claims alter column user_id drop not null;
alter table public.reserve_claims drop constraint if exists reserve_claims_user_id_fkey;
alter table public.reserve_claims add constraint reserve_claims_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

comment on column public.reserve_claims.state is
  'held (0014: paid at the truck, timed) · pending (being paid, 0400) · paid · collected (handed over) · expired · cancelled';

-- ── when its pickup closes ─────────────────────────────────────────────────────────────────────────────────────────
-- The pack rule (0397 pack_closes_at), for the reserve's stop: 24 hours before it. No stop, or a stop called off: null —
-- a reserve that cannot be paid for.
create or replace function public.reserve_closes_at(p_reserve uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select case when s.id is null or s.canceled_at is not null or s.starts_at is null then null
              else public.pack_closes_at((s.starts_at at time zone 'America/New_York')::date, s.id) end
    from public.reserves r
    left join public.stops s on s.id = r.stop_id
   where r.id = p_reserve
$$;
revoke all on function public.reserve_closes_at(uuid) from public, anon;
grant execute on function public.reserve_closes_at(uuid) to authenticated, service_role;

-- ── the hold ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.hold_reserve(p_user uuid, p_reserve uuid, p_qty integer, p_key text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.reserves%rowtype;
  s public.stops%rowtype;
  c public.reserve_claims%rowtype;
  v_have integer;
  v_tier text;
  v_close timestamptz;
begin
  if p_user is null or p_key is null or length(p_key) < 8 then
    raise exception 'A hold needs a member and a checkout key.' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 12 then
    raise exception 'Pick how many — between 1 and 12.' using errcode = '22023';
  end if;

  -- The same key again is the same claim — while it stands. One that ended (refused by the card, released) gives its
  -- key up, and this is a new hold.
  select * into c from public.reserve_claims where idempotency_key = p_key for update;
  if found then
    if c.state in ('pending', 'paid', 'collected') then
      if c.user_id is distinct from p_user then
        raise exception 'That checkout is someone else''s.' using errcode = '42501';
      end if;
      select * into r from public.reserves where id = c.reserve_id;
      return jsonb_build_object('id', c.id, 'state', c.state, 'qty', c.qty, 'again', true,
        'amount_cents', coalesce(c.paid_cents, c.qty * r.price_cents));
    end if;
    update public.reserve_claims set idempotency_key = p_key || '~' || left(c.id::text, 8) where id = c.id;
  end if;

  select * into r from public.reserves where id = p_reserve for update;
  if not found or r.status not in ('live', 'sold_out') or r.stop_id is null then
    raise exception 'That reserve isn''t on offer right now.' using errcode = 'PT404';
  end if;
  select * into s from public.stops where id = r.stop_id;
  if s.canceled_at is not null then
    raise exception 'Its pickup was called off — check back for the new one.' using errcode = 'PT409';
  end if;
  v_close := public.reserve_closes_at(r.id);
  if v_close is null or now() >= v_close then
    raise exception 'Reserves for that pickup have closed.' using errcode = 'PT409';
  end if;
  if r.member_only then
    select tier into v_tier from public.customers where user_id = p_user;
    if coalesce(v_tier, 'guest') = 'guest' then
      raise exception 'This reserve is for members.' using errcode = '42501';
    end if;
  end if;
  select coalesce(sum(qty), 0) into v_have from public.reserve_claims
   where reserve_id = r.id and user_id = p_user and state in ('held', 'pending', 'paid', 'collected');
  if v_have + p_qty > r.per_member_limit then
    raise exception 'That is more than one member may reserve.' using errcode = 'PT409';
  end if;
  if r.stock_remaining < p_qty then
    if r.stock_remaining > 0 then
      raise exception 'Only % left.', r.stock_remaining using errcode = 'PT409';
    end if;
    raise exception 'Sold out.' using errcode = 'PT409';
  end if;

  update public.reserves
     set stock_remaining = stock_remaining - p_qty,
         status = case when stock_remaining - p_qty = 0 then 'sold_out' else status end
   where id = r.id;
  insert into public.reserve_claims (reserve_id, user_id, qty, state, idempotency_key, tenant_id)
  values (r.id, p_user, p_qty, 'pending', p_key, r.tenant_id)
  returning * into c;
  return jsonb_build_object('id', c.id, 'state', c.state, 'qty', c.qty, 'again', false, 'amount_cents', p_qty * r.price_cents);
end $$;
revoke all on function public.hold_reserve(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.hold_reserve(uuid, uuid, integer, text) to service_role;

-- ── paid ───────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.settle_reserve(p_claim uuid, p_payment_id text, p_paid_cents integer)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.reserve_claims%rowtype;
begin
  select * into c from public.reserve_claims where id = p_claim for update;
  if not found then
    raise exception 'That claim is gone.' using errcode = 'PT404';
  end if;
  if c.state in ('paid', 'collected') and c.payment_id is not distinct from p_payment_id then
    return jsonb_build_object('id', c.id, 'state', c.state, 'again', true);
  end if;
  if c.state <> 'pending' then
    raise exception 'That claim is %, not waiting on its payment.', c.state using errcode = 'PT409';
  end if;
  update public.reserve_claims
     set state = 'paid', payment_id = p_payment_id, paid_cents = greatest(coalesce(p_paid_cents, 0), 0)
   where id = p_claim;
  return jsonb_build_object('id', c.id, 'state', 'paid', 'again', false);
end $$;
revoke all on function public.settle_reserve(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.settle_reserve(uuid, text, integer) to service_role;

-- ── let go: the bottles back on the shelf ──────────────────────────────────────────────────────────────────────────
create or replace function public.release_reserve(p_claim uuid, p_reason text, p_refunded_cents integer default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.reserve_claims%rowtype;
begin
  select * into c from public.reserve_claims where id = p_claim for update;
  if not found then
    raise exception 'That claim is gone.' using errcode = 'PT404';
  end if;
  if c.state in ('cancelled', 'expired') then
    -- Released already: a refund said again keeps the larger of the two, never more than was paid.
    update public.reserve_claims
       set refunded_cents = greatest(refunded_cents, least(coalesce(paid_cents, 0), greatest(coalesce(p_refunded_cents, 0), 0)))
     where id = c.id;
    return jsonb_build_object('id', c.id, 'state', c.state, 'again', true);
  end if;
  if c.state not in ('held', 'pending', 'paid') then
    raise exception 'That claim was handed over — its bottles are not ours to put back.' using errcode = 'PT409';
  end if;
  update public.reserve_claims
     set state = 'cancelled', canceled_at = now(), cancel_reason = left(coalesce(nullif(trim(p_reason), ''), 'released'), 200),
         refunded_cents = greatest(refunded_cents, least(coalesce(paid_cents, 0), greatest(coalesce(p_refunded_cents, 0), 0)))
   where id = c.id;
  update public.reserves
     set stock_remaining = least(stock_total, stock_remaining + c.qty),
         status = case when status = 'sold_out' then 'live' else status end
   where id = c.reserve_id;
  return jsonb_build_object('id', c.id, 'state', 'cancelled', 'again', false);
end $$;
revoke all on function public.release_reserve(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.release_reserve(uuid, text, integer) to service_role;

-- ── handed over ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.collect_reserve_claim(p_claim uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.reserve_claims%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Only the crew hands a reserve over.' using errcode = '42501';
  end if;
  select * into c from public.reserve_claims where id = p_claim for update;
  if not found then
    raise exception 'That claim is gone.' using errcode = 'PT404';
  end if;
  if c.state = 'collected' then
    return jsonb_build_object('id', c.id, 'state', c.state, 'again', true);
  end if;
  if c.state not in ('paid', 'held') then
    raise exception 'That claim is %, not owed a bottle.', c.state using errcode = 'PT409';
  end if;
  update public.reserve_claims set state = 'collected', collected_at = now(), collected_by = auth.uid() where id = c.id;
  return jsonb_build_object('id', c.id, 'state', 'collected', 'again', false);
end $$;
revoke all on function public.collect_reserve_claim(uuid) from public, anon;
grant execute on function public.collect_reserve_claim(uuid) to authenticated;

-- ── the crew's lists ───────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff read claims" on public.reserve_claims;
create policy "staff read claims" on public.reserve_claims for select using ((select public.is_staff()));

-- ── a hold paid at the truck is gone ───────────────────────────────────────────────────────────────────────────────
revoke execute on function public.claim_reserve(uuid, integer) from public, anon, authenticated;

-- ── a reserve people paid for stays up until they have their bottles or their money ────────────────────────────────
create or replace function public.reserve_keeps_its_paid_claims() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('draft', 'archived') and old.status is distinct from new.status
     and exists (select 1 from public.reserve_claims c where c.reserve_id = new.id and c.state in ('pending', 'paid')) then
    raise exception 'People have paid for this reserve — hand their bottles over or refund them before taking it down.'
      using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.reserve_keeps_its_paid_claims() from public, anon, authenticated;
drop trigger if exists reserve_keeps_its_paid_claims on public.reserves;
create trigger reserve_keeps_its_paid_claims before update of status on public.reserves
  for each row execute function public.reserve_keeps_its_paid_claims();

-- ── a refund made in Square finds its claim (0390) ─────────────────────────────────────────────────────────────────
alter table public.square_refunds drop constraint if exists square_refunds_channel_check;
alter table public.square_refunds add constraint square_refunds_channel_check
  check (channel is null or channel in ('shop', 'cup', 'pickup', 'delivery', 'reserve'));

-- 0390's function, and a reserve's claim by the payment it was paid with.
create or replace function public.refund_order_of(p_payment_id text, out channel text, out order_id uuid)
  language plpgsql stable set search_path = public as $$
begin
  select 'shop', s.id into channel, order_id from public.shop_orders s where s.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'cup', o.id into channel, order_id from public.orders o where o.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'pickup', d.id into channel, order_id from public.drop_orders d where d.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'pickup', c.drop_order_id into channel, order_id from public.drop_order_changes c where c.charge_payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'delivery', v.id into channel, order_id from public.delivery_orders v where v.payment_id = p_payment_id limit 1;
  if order_id is not null then return; end if;
  select 'reserve', rc.id into channel, order_id from public.reserve_claims rc where rc.payment_id = p_payment_id limit 1;
  if order_id is null then channel := null; end if;
end $$;
revoke all on function public.refund_order_of(text) from public, anon, authenticated;

-- 0390's function, and a reserve: all of a paid claim's money back releases it (the bottles back on the shelf); part of
-- it, or any of a claim already handed over or released, is kept on the claim — never more than was paid. A reserve
-- earns no stamps, so there are none to take.
create or replace function public.square_refund_claws() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_in integer; v_back integer; c public.reserve_claims%rowtype;
begin
  if new.status is distinct from 'COMPLETED' or new.channel is null or new.channel = 'shop' or new.channel_order_id is null then return new; end if;
  if new.channel = 'reserve' then
    select * into c from public.reserve_claims where id = new.channel_order_id for update;
    if not found then return new; end if;
    select coalesce(sum(r.amount_cents), 0) into v_back from public.square_refunds r
     where r.channel = 'reserve' and r.channel_order_id = c.id and r.status = 'COMPLETED';
    if c.state = 'paid' and coalesce(c.paid_cents, 0) > 0 and v_back >= c.paid_cents then
      perform public.release_reserve(c.id, 'refunded in Square', v_back);
    elsif c.state in ('paid', 'collected', 'cancelled') then
      update public.reserve_claims set refunded_cents = greatest(refunded_cents, least(coalesce(paid_cents, 0), v_back)) where id = c.id;
    end if;
    return new;
  end if;
  if new.channel = 'cup' then
    select o.user_id, o.total_cents into v_user, v_in from public.orders o where o.id = new.channel_order_id;
  elsif new.channel = 'delivery' then
    select v.user_id, v.total_cents into v_user, v_in from public.delivery_orders v where v.id = new.channel_order_id;
  else
    select d.user_id, public.pack_paid_in(d.id) into v_user, v_in from public.drop_orders d where d.id = new.channel_order_id;
  end if;
  if v_user is null or coalesce(v_in, 0) <= 0 then return new; end if;
  select coalesce(sum(r.amount_cents), 0) into v_back from public.square_refunds r
   where r.channel = new.channel and r.channel_order_id = new.channel_order_id and r.status = 'COMPLETED';
  if v_back < v_in then return new; end if;
  insert into public.loyalty_ledger (user_id, order_id, channel, kind, points, note)
  select l.user_id, l.order_id, l.channel, 'clawback', -l.points, 'refunded in Square'
    from public.loyalty_ledger l
   where l.user_id = v_user and l.order_id = new.channel_order_id and l.channel = new.channel and l.kind = 'award'
  on conflict (user_id, order_id, channel, kind) where order_id is not null do nothing;
  return new;
end $$;
revoke all on function public.square_refund_claws() from public, anon, authenticated;

-- ── the books ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- 0384's report_sales, and reserves: what they took in, less what went back, as their own channel ('reserve'), counted
-- under the same rule as their money — a claim paid through 0400 (a hold paid at the truck was the truck's money, and
-- Square's feed has it); a reserve's payment is not walk-up money (event_sales carries Square's payments).
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint; resv bigint;
  sq_n bigint;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
                and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  resv   := coalesce((select sum(paid_cents - refunded_cents) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at >= since and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop + resv,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop, 'reserve', resv),
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
             and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents - coalesce(refund_amount_cents, 0)), 0) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(paid_cents - refunded_cents), 0) from reserve_claims where state in ('paid', 'collected') and paid_cents is not null and created_at::date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;

-- 0384's report_events, and a reserve's payment joins no event.
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
                 and not exists (select 1 from reserve_claims rc where rc.payment_id = es.square_payment_id)
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

-- ── existing rows ──────────────────────────────────────────────────────────────────────────────────────────────────
-- A claim marked paid by hand (0014: paid at the truck — no payment here, no amount) was handed over when it was paid.
update public.reserve_claims set state = 'collected'
 where state = 'paid' and paid_cents is null and payment_id is null;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A Limited Reserve is yours when it is paid', 'feature', 'Reserves',
   'Reserve a Limited Reserve bottle by paying for it, and it is yours — no timer. Each reserve names its pickup; cancel up to 24 hours before it for a full refund. On the day, the crew has the list of who is owed a bottle and hands it over.',
   '2026-10-14', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0400_a_limited_reserve_is_paid_to_hold');

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'reserves' and column_name = 'stop_id';                -- 1
--   select count(*) from information_schema.columns where table_name = 'reserve_claims'
--      and column_name in ('idempotency_key', 'payment_id', 'paid_cents', 'refunded_cents', 'canceled_at', 'cancel_reason',
--                          'collected_at', 'collected_by');                                                                   -- 8
--   select count(*) from pg_proc where proname in ('hold_reserve', 'settle_reserve', 'release_reserve', 'collect_reserve_claim',
--      'reserve_closes_at', 'reserve_keeps_its_paid_claims');                                                                 -- 6
--   select has_function_privilege('authenticated', 'public.hold_reserve(uuid,uuid,integer,text)', 'execute');                 -- false
--   select has_function_privilege('authenticated', 'public.claim_reserve(uuid,integer)', 'execute');                          -- false
--   select count(*) from pg_policies where tablename = 'reserve_claims';                                                      -- 4
--   select count(*) from pg_trigger where tgname = 'reserve_keeps_its_paid_claims';                                            -- 1
--   select count(*) from public.reserve_claims where state = 'paid' and payment_id is null and paid_cents is null;            -- 0
