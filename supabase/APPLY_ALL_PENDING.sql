-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0396
-- generated-at: 2026-10-13
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0396_a_guest_cancels_from_the_ticket.sql
-- ============================================================
-- ── 0396 — A GUEST CANCELS FROM THE TICKET ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-13 (R3c of the customer audit — the rest of board 09 and plan row R3, "Cancel reports its outcome").
--
-- WHY. A member cancels a cup order from Today or the bar while it is still in (cancel_own_order, 0341: only theirs,
-- only before it is being made, never once paid at the window — that is the crew's, at the window). A guest has no
-- account to be the owner of anything: the ticket (0395) shows them the order and lets them tell the truck they are
-- on the way, and nothing let them take it back. They walked up to the window to say so, or didn't come.
--
-- WHAT.
--   · cancel_by_ticket(t) — the same rule as a member's cancel, by the ticket instead of the account: the order is
--     the ticket's; only while it is In (new); never once paid at the window. It answers in the words the screens
--     already use (lib/orderWords cancelWords): {ok, outcome: canceled | too_late (+ now) | at_window, paid}. An
--     unknown ticket is refused in words, as a 4xx (PT404). Whoever holds the link may cancel, as whoever holds it may
--     read it and tell the truck: the ticket is the key.
--   · The crew hear it as they hear a member's: a card-paid order is a critical money alert to refund it in Square
--     (as cancel_own_order raises), an unpaid one an FYI that nothing was charged (as /api/orders/cancel raises).
--   · order_ticket(t) also says whether the order was paid at the window (at_window), so the ticket offers Cancel only
--     when it can go through.
--
-- A second run changes nothing.

-- ── the ticket's view, as 0395 made it, and whether it was paid at the window ──────────────────────────────────────────────────────────────────────────────────────────────
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
    'stop',        case when s.name is not null then jsonb_build_object(
                     'name', s.name, 'place', s.place, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                     'lat', s.lat, 'lng', s.lng, 'canceled', s.canceled_at is not null, 'cancel_reason', s.cancel_reason) end
  );
end $$;
revoke all on function public.order_ticket(uuid) from public;
grant execute on function public.order_ticket(uuid) to anon, authenticated;

-- ── take it back, from the ticket ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_by_ticket(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  v_no  text;
  v_who text;
begin
  select * into o from public.orders where ticket = p_ticket for update;
  if not found then
    raise exception 'That ticket isn''t one of ours.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  -- the member's rule (cancel_own_order, 0341): only while it is In, never once paid at the window
  if o.status <> 'new' then return jsonb_build_object('ok', false, 'outcome', 'too_late', 'now', o.status); end if;
  if o.collected_at is not null then return jsonb_build_object('ok', false, 'outcome', 'at_window'); end if;

  update public.orders set status = 'void' where id = o.id;

  v_no  := '#' || upper(substr(o.id::text, 1, 4));
  v_who := coalesce(nullif(split_part(btrim(coalesce(o.customer, '')), ' ', 1), ''), 'A guest');
  if coalesce(o.paid, false) then
    insert into public.alerts (severity, category, title, body, link)
    values ('critical', 'money', 'Customer canceled a paid order — refund needed',
            v_who || ' canceled order ' || v_no || ' ($' || to_char((o.total_cents / 100.0)::numeric, 'FM999990.00')
              || ') from its order page. Refund it in Square.',
            '/admin');
  else
    insert into public.alerts (severity, category, title, body, link)
    values ('fyi', 'order', 'Canceled: ' || v_who || '''s cup order',
            v_who || ' canceled order ' || v_no || ' from its order page. Nothing was charged — no refund needed.',
            '/crew');
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'canceled', 'paid', coalesce(o.paid, false));
end $$;
-- existing rows: cancel_by_ticket — new in this migration; it has written no alert to restate.
revoke all on function public.cancel_by_ticket(uuid) from public;
grant execute on function public.cancel_by_ticket(uuid) to anon, authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A guest can cancel from the order page', 'improvement', 'Ordering',
   'The order page a guest gets after paying has Cancel while the order is still in — the same rule as a member''s: not once it is being made, and not once paid at the window. A card-paid order is flagged for a full refund, and the crew is told either way.',
   '2026-10-13', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0396_a_guest_cancels_from_the_ticket');

-- verify:
--   select count(*) from pg_proc where proname = 'cancel_by_ticket';                                             -- 1
--   select has_function_privilege('anon', 'public.cancel_by_ticket(uuid)', 'execute');                          -- true
--   select prosrc like '%at_window%' from pg_proc where proname = 'order_ticket';                               -- true
