-- ── 0390 — A REFUND TAKES ITS STAMPS BACK, AND A CUP KEEPS ITS TIP ─────────────────────────────────────────────────
-- 2026-10-12. H9 of the customer frontend audit, release C1 (the owner approved the release, "yes to all improvements").
--
-- WHY. A refunded cup or pack kept its stamps: a refund issued in Square reached this database (0330, the webhook's
-- refund branch) but was matched to shop orders only, so a cup, a pack or a delivery refunded in full went on
-- counting toward a free cup. And a cup's tip was charged and kept nowhere: orders.total_cents is the goods, so a
-- refund of goods and tip could not be told from a refund of the goods alone, and the books had no tips at all.
--
-- WHAT.
--   · orders.tip_cents — the tip charged with a cup order (/api/checkout writes it; 0 for pay at pickup and for every
--     order before this). The charge was always total_cents + tip_cents.
--   · square_refunds.channel, channel_order_id — every refund matched to its order by the payment it refunds: a shop
--     order, a cup, a pack (its reservation's payment, or a difference a pack change charged — 0388), a delivery.
--     Matched as the row is written (square_refund_match, before insert or update), and once here for the rows
--     already kept.
--   · When a refund completes and the order's money is back — a cup's or a delivery's goods (total_cents), a pack's
--     every payment in (what it holds now, plus what its changes refunded, plus a charge given back) — the stamps that
--     order earned come off, once (the ledger's 'clawback', one per order, as a void takes them: 0229). A partial
--     refund keeps them. A refund of a pack that was never picked up has no stamps to take.
-- Untouched: the webhook's own writes and its shop alert; refund_amount_cents (0313's, the operator's account); every
-- award and clawback rule of 0229. Refunds already kept are matched, not acted on: no balance changes for the past.
--
-- ORDER. Paste it before the deploy that writes tip_cents. Pasted after, nothing breaks: until it is here the cup
-- checkout writes its order without the tip (lib/schemaSkew.writeAcrossSkew, the one column named).
-- existing rows: square_refunds rows get their channel (no stamps move); orders get tip_cents 0.
-- changelog: below.

alter table public.orders add column if not exists tip_cents integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_tip_cents_check') then
    alter table public.orders add constraint orders_tip_cents_check check (tip_cents >= 0);
  end if;
end $$;
comment on column public.orders.tip_cents is
  'The tip charged with this cup order (0390). The card was charged total_cents + tip_cents; total_cents is the goods.';

alter table public.square_refunds add column if not exists channel text;
alter table public.square_refunds add column if not exists channel_order_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'square_refunds_channel_check') then
    alter table public.square_refunds add constraint square_refunds_channel_check
      check (channel is null or channel in ('shop', 'cup', 'pickup', 'delivery'));
  end if;
end $$;
create index if not exists square_refunds_channel_order on public.square_refunds (channel, channel_order_id);

-- The order a refund belongs to, by the payment it refunds. Null when no order here carries that payment.
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
  if order_id is null then channel := null; end if;
end $$;

-- What a pack took in, in all: what it holds now, plus what its applied changes refunded, plus any charge a change
-- made and gave back (0388's stale) — so a refund of all of it is "the money is back", and a change's own refund is not.
create or replace function public.pack_paid_in(p_order uuid) returns integer
  language sql stable set search_path = public as $$
  select case when d.paid then d.total_cents else 0 end
       + coalesce((select sum((x->>'cents')::int) from public.drop_order_changes c, jsonb_array_elements(c.refunds) x
                    where c.drop_order_id = d.id and c.state = 'done'), 0)
       + coalesce((select sum(c.diff_cents) from public.drop_order_changes c
                    where c.drop_order_id = d.id and c.state = 'stale' and c.charge_payment_id is not null), 0)
    from public.drop_orders d where d.id = p_order
$$;

-- Both trigger functions are definers: the webhook writes refunds with the service role, and what they read (every
-- order table) and write (the ledger) is no business of whoever wrote the refund row.
create or replace function public.square_refund_match() returns trigger
  language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.channel is null and new.payment_id is not null then
    select * into m from public.refund_order_of(new.payment_id);
    new.channel := m.channel;
    new.channel_order_id := m.order_id;
  end if;
  return new;
end $$;

-- A refund that completes: when the order's money is all back, its stamps come off — once.
create or replace function public.square_refund_claws() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_in integer; v_back integer;
begin
  if new.status is distinct from 'COMPLETED' or new.channel is null or new.channel = 'shop' or new.channel_order_id is null then return new; end if;
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

drop trigger if exists square_refund_match_tg on public.square_refunds;
create trigger square_refund_match_tg before insert or update on public.square_refunds
  for each row execute function public.square_refund_match();
drop trigger if exists square_refund_claws_tg on public.square_refunds;
create trigger square_refund_claws_tg after insert or update of status, amount_cents on public.square_refunds
  for each row execute function public.square_refund_claws();

revoke all on function public.refund_order_of(text) from public, anon, authenticated;
revoke all on function public.pack_paid_in(uuid) from public, anon, authenticated;
revoke all on function public.square_refund_match() from public, anon, authenticated;
revoke all on function public.square_refund_claws() from public, anon, authenticated;

-- The refunds already kept: matched to their orders, nothing else. Updating the channel alone does not fire the
-- clawback trigger (it watches status and amount), so no balance moves for the past.
update public.square_refunds r set channel = m.channel, channel_order_id = m.order_id
  from (select x.id, (public.refund_order_of(x.payment_id)).* from public.square_refunds x where x.channel is null) m
 where r.id = m.id and m.channel is not null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A refund takes its stamps back','fix','Loyalty',
   'A cup, a pack or a delivery refunded in full in Square kept the stamps it earned, because refunds reached only shop orders here. Now every refund is matched to its order, and when an order''s money is all back its stamps come off, once — a partial refund keeps them, and refunds from before this are left as they were. A cup''s tip is kept with its order now, so the books can tell the tip from the drinks.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'orders' and column_name = 'tip_cents';      -- 1
--   select channel, count(*) from public.square_refunds group by 1;                                                  -- matched
--   select count(*) from pg_trigger where tgname in ('square_refund_match_tg', 'square_refund_claws_tg');           -- 2
select public.record_migration('0390_a_refund_takes_its_stamps_back');
