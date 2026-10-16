-- ── 0413 — A SHARED LINK SHOWS THE ORDER, AND ONLY THE PHONE THAT PLACED IT CHANGES IT ────────────────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. An order's ticket (0395) is the key of its page: whoever holds /order?t=… reads the order — the first name, the
-- drinks and their prices, the tip, the card's brand and last four, what was refunded — tells the truck "I'm outside"
-- (0395 ticket_eta), and cancels it while it is In (0396 cancel_by_ticket), the crew told the customer canceled it.
-- And the page's Share link sent that same key. Sharing an order with the friend picking it up gave them its Cancel,
-- the card's last four and the truck's chime.
--
-- WHAT.
--   · orders.share — a second key for each order, made with it, for its shared link (/order?s=…).
--   · order_shared(s) — what a shared link opens: the order's number, where it is, its drinks (no prices), whether it is
--     paid or what is due at the window, the first name it is for, and the stop — nothing that changes it, and nothing
--     about the card, the tip or refunds. An unknown link is refused in words, as a 4xx (PT404, 0360).
--   · order_ticket(t) — 0396's view, and the share key, so the ticket's Share link sends that one.
-- The ticket stays the key to its order for whoever already holds it — links shared before this keep working.
-- changelog: below.

alter table public.orders add column if not exists share uuid default gen_random_uuid();
update public.orders set share = gen_random_uuid() where share is null;
alter table public.orders alter column share set not null;
create unique index if not exists orders_share_key on public.orders (share);
comment on column public.orders.share is
  'The order''s shared link (0413): /order?s=… shows the order — where it is, its drinks, what is due — and changes nothing. The ticket (0395) is the key to change it.';

-- ── the ticket's view (0396's), and its share key ────────────────────────────────────────────────────────────────
create or replace function public.order_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o record;
  s record;
begin
  select id, items, status, created_at, status_changed_at, total_cents, tip_cents, paid, payment_status, collected_at,
         ready_from, eta_status, customer, stop_id, lines, card_brand, card_last4, payment_id, share
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
    -- paid at the window (0341): the crew's to cancel there, so the ticket offers no Cancel (0396)
    'at_window',   o.collected_at is not null,
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
    -- the key its Share link sends (0413): a view of the order, never its ticket
    'share',       o.share,
    'stop',        case when s.name is not null then jsonb_build_object(
                     'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                     'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
revoke all on function public.order_ticket(uuid) from public, anon, authenticated;
grant execute on function public.order_ticket(uuid) to anon, authenticated;

-- ── what a shared link opens ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.order_shared(p_share uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o      record;
  s      record;
  v_paid boolean;
begin
  select id, items, status, created_at, status_changed_at, total_cents, paid, payment_status, collected_at, ready_from,
         customer, stop_id, lines
    into o from public.orders where share = p_share;
  if o.id is null then
    raise exception 'That link isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  v_paid := coalesce(o.paid, false) or o.collected_at is not null or coalesce(o.payment_status = 'paid', false);
  select name, coalesce(address, location_text) as place, starts_at, ends_at, lat, lng, canceled_at, cancel_reason
    into s from public.stops where id = o.stop_id;
  return jsonb_build_object(
    'no',         '#' || upper(left(o.id::text, 4)),
    'status',     o.status,
    'items',      to_jsonb(o.items),
    -- the drinks and how many, never what they cost
    'lines',      (select jsonb_agg(jsonb_build_object('slug', l->>'slug', 'name', l->>'name', 'qty', coalesce((l->>'qty')::int, 1)))
                     from jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l),
    'paid',       v_paid,
    -- what the person picking it up pays at the window, if anything
    'due_cents',  case when v_paid or o.status = 'void' then 0 else o.total_cents end,
    'placed_at',  o.created_at,
    'moved_at',   o.status_changed_at,
    'ready_from', o.ready_from,
    'for',        nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''),
    'stop',       case when s.name is not null then jsonb_build_object(
                    'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                    'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
comment on function public.order_shared(uuid) is
  'What an order''s shared link opens (0413): its number, where it is, its drinks, what is due at the window, the first name and the stop — nothing that changes it, nothing about the card, the tip or refunds. Anyone with the link.';
revoke all on function public.order_shared(uuid) from public, anon, authenticated;
grant execute on function public.order_shared(uuid) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Sharing an order shares where it is, not its Cancel', 'fix', 'Ordering',
   'Share link on an order now sends a link that shows the order — where it is, what''s in it, what''s due at the window — and nothing that changes it: no Cancel, no "I''m outside", nothing about your card. Only the phone that placed the order can change it.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.orders where share is null;                                                     -- 0
--   select has_function_privilege('anon', 'public.order_shared(uuid)', 'execute');                              -- true
--   select prosrc like '%''share'',       o.share%' from pg_proc where proname = 'order_ticket';                -- true
select public.record_migration('0413_a_shared_link_shows_the_order');
