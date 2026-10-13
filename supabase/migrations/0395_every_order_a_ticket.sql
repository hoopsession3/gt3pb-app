-- ── 0395 — EVERY ORDER A TICKET ─────────────────────────────────────────────────────────────────────────────────────────
-- 2026-10-13 (R3b of the customer audit, board 09 "Every order gets a ticket", approved 2026-10-12).
--
-- WHY. A guest who paid for a cup had the "Order in." screen and nothing after it: no number, no way back once the sheet
-- closed, no word while they waited. The bar and Today are a member's (they read the member's own rows), and a status
-- push needs an account. Every order now carries a ticket — a link that shows that one order to whoever holds it: its
-- number, where it is, what was in it and what was paid, the stop and its hours — the way the bar and Today show a
-- member's.
--
-- WHAT.
--   · orders.ticket — a random uuid for every order, old ones too, unique. It is the link's key and nothing else:
--     whoever has it sees that order and no other. (A member reads it on their own rows, as every column.)
--   · orders.lines — the receipt's lines as checkout priced them ([{slug, qty, unit_cents}]); orders.card_brand and
--     orders.card_last4 — "Visa ··4242", from Square's answer. Never more of a card than its last four.
--   · order_ticket(t) — the ticket's view, to anyone with t, signed in or not: the number, the status, the items and
--     their lines, the total and the tip, whether it is paid and how, what Square has refunded on it (0330's
--     square_refunds: completed, and whether one is still pending), when it is made from, the stop's name, place and
--     hours, and the first name it is for. Nothing about anyone else. An unknown ticket is refused in words, as a 4xx
--     (PT404, 0360).
--   · ticket_eta(t, eta) — On my way / I'm outside / Running late from the ticket, as set_order_eta (0138) is from a
--     member's own row: only while the order is in progress.
--
-- A second run changes nothing.

alter table public.orders add column if not exists ticket uuid default gen_random_uuid();
update public.orders set ticket = gen_random_uuid() where ticket is null;
alter table public.orders alter column ticket set not null;
create unique index if not exists orders_ticket_key on public.orders (ticket);
comment on column public.orders.ticket is
  'The order''s ticket (0395): the key of its link, /order?t=…, which shows this order and no other to whoever holds it.';

alter table public.orders add column if not exists lines jsonb;
alter table public.orders add column if not exists card_brand text;
alter table public.orders add column if not exists card_last4 text;
do $$ begin
  alter table public.orders add constraint orders_card_last4_four check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
exception when duplicate_object then null; end $$;

-- ── the ticket's view ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.order_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  s record;
begin
  select id, items, status, created_at, status_changed_at, total_cents, tip_cents, paid, payment_status, collected_at,
         ready_from, eta_status, customer, stop_id, lines, card_brand, card_last4, payment_id
    into o from public.orders where ticket = p_ticket;
  if o.id is null then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  select name, coalesce(address, location_text) as place, starts_at, ends_at, lat, lng, canceled_at, cancel_reason
    into s from public.stops where id = o.stop_id;
  return jsonb_build_object(
    'no',          '#' || upper(left(o.id::text, 4)),
    'status',      o.status,
    'items',       to_jsonb(o.items),
    'lines',       o.lines,
    'total_cents', o.total_cents,
    'tip_cents',   coalesce(o.tip_cents, 0),
    'paid',        coalesce(o.paid, false) or o.collected_at is not null or coalesce(o.payment_status = 'paid', false),
    'card',        case when o.card_last4 is not null then coalesce(nullif(o.card_brand, ''), 'Card') || ' ··' || o.card_last4 end,
    -- what Square says left for it (0330) — money back is a fact Square reports, never this view's guess
    'refunded_cents', coalesce((select sum(r.amount_cents) from public.square_refunds r
                                 where o.payment_id is not null and r.payment_id = o.payment_id and r.status = 'COMPLETED'), 0),
    'refund_pending', exists (select 1 from public.square_refunds r
                                where o.payment_id is not null and r.payment_id = o.payment_id and r.status = 'PENDING'),
    'placed_at',   o.created_at,
    'moved_at',    o.status_changed_at,
    'ready_from',  o.ready_from,
    'eta',         o.eta_status,
    'for',         nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''),
    'stop',        case when s.name is not null then jsonb_build_object(
                     'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                     'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
revoke all on function public.order_ticket(uuid) from public;
grant execute on function public.order_ticket(uuid) to anon, authenticated;

-- ── tell the truck, from the ticket ────────────────────────────────────────────────────────────────────────────────
create or replace function public.ticket_eta(p_ticket uuid, p_eta text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_status text;
begin
  if p_eta is not null and p_eta not in ('on_way', 'outside', 'late') then
    raise exception 'That isn''t something we can tell the truck.' using errcode = '22023';
  end if;
  select id, status into v_id, v_status from public.orders where ticket = p_ticket for update;
  if v_id is null then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';
  end if;
  -- in progress only: a picked-up or canceled order is history, with nothing to tell the truck
  if v_status not in ('new', 'preparing', 'ready') then return false; end if;
  update public.orders set eta_status = p_eta, eta_at = case when p_eta is null then null else now() end where id = v_id;
  return true;
end $$;
revoke all on function public.ticket_eta(uuid, text) from public;
grant execute on function public.ticket_eta(uuid, text) to anon, authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every order gets a ticket', 'feature', 'Ordering',
   'Every cup order has a number and a link — guests too. The link shows where the order is, what was in it and what was paid, and tells the truck you are on your way; it updates itself while you wait.',
   '2026-10-13', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- 0391's entry said everyone with a cup ordered for a canceled stop "gets a text or an email". A guest got nothing — we
-- have no address for one — and nothing sends a text. It says what is true now: a member is told by email, and on their
-- phone where alerts are on; a guest's order page says so (the ticket, above).
update public.changelog
   set summary = replace(summary, 'everyone with a cup ordered for it gets a text or an email',
                                  'a member with a cup ordered for it is told by email (and on their phone, where alerts are on), and a guest''s order page says so')
 where title = 'A canceled stop says so' and summary like '%everyone with a cup ordered for it gets a text or an email%';

select public.record_migration('0395_every_order_a_ticket');

-- verify:
--   select count(*) from information_schema.columns where table_name = 'orders' and column_name in ('ticket', 'lines', 'card_brand', 'card_last4');  -- 4
--   select count(*) from public.orders where ticket is null;                                                   -- 0
--   select count(*) from pg_proc where proname in ('order_ticket', 'ticket_eta');                            -- 2
