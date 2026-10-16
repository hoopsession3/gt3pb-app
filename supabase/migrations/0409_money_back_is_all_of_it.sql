-- ── 0409 — MONEY BACK IS ALL OF IT: A CANCELED ORDER'S REFUND NAMES THE TIP ─────────────────────────────────────────
-- 2026-10-15. R7 of the customer re-audit — the money that went back short (Ryan, 2026-10-15: "Keep working to improve
-- to a 10"). Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A card pays for a cup order's drinks and its tip in one charge (orders.total_cents + orders.tip_cents, 0390), and
-- a canceled order is refunded by hand in Square, from the alert that says how much. Both alerts the database raises
-- said the drinks' total: a member's cancel (cancel_own_order, 0341) and a guest's, from the order page
-- (cancel_by_ticket, 0396). The crew refunded what they were told and the tip stayed on the card — and the order page,
-- which counts the tip, said "The refund is on its way to your card" for good: a refund short of the charge is never
-- "in full", which is what the page, the email and the Terms promise.
--
-- WHAT. Both alerts say what the card was charged — the drinks and the tip, and which is which (refund_words) — and are
-- the alert the Pass's void raises (components/pass/ThePass): kind refund_needed, about the order, one per order
-- (alert_open_once), with Marked refunded on its card and Money › Get paid behind it. The guest's says who canceled from
-- where, as it did. Who may cancel, and when, are 0341's and 0396's, unchanged — and so is the unpaid cancel's FYI.
--
-- existing rows: cancel_own_order — the refund alerts it already wrote carry no order to read a tip from (no subject);
-- an open one is closed by whoever refunds it, in Square, where the charge shows in full.
-- existing rows: cancel_by_ticket — the same: its alerts name an order by its four characters only, and Square shows
-- the charge in full.
-- changelog: below.

-- ── what the card was charged, said one way ────────────────────────────────────────────────────────────────────────
create or replace function public.refund_words(p_drinks integer, p_tip integer) returns text
  language sql immutable set search_path = public as $$
  select '$' || to_char(((coalesce(p_drinks, 0) + greatest(coalesce(p_tip, 0), 0)) / 100.0)::numeric, 'FM999990.00')
      || case when coalesce(p_tip, 0) > 0
              then ' (drinks $' || to_char((coalesce(p_drinks, 0) / 100.0)::numeric, 'FM999990.00')
                   || ' + tip $' || to_char((p_tip / 100.0)::numeric, 'FM999990.00') || ')'
              else '' end
$$;
comment on function public.refund_words(integer, integer) is
  'What a cup order''s card was charged, for a refund alert (0409): "$11.50 (drinks $10.00 + tip $1.50)", or "$10.00" with no tip.';
revoke all on function public.refund_words(integer, integer) from public, anon, authenticated;

-- ── a member's cancel (0341's, the alert restated) ─────────────────────────────────────────────────────────────────
create or replace function public.cancel_own_order(p_order uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  -- FOR UPDATE added: cancel_own_reservation (0136) and cancel_own_delivery (0139) already lock
  -- their row here; this one didn't, so two concurrent cancels (double-tap / client retry) could
  -- both read status='new' before either write landed and both insert a refund alert.
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then return false; end if;      -- not yours (or doesn't exist)
  if o.status <> 'new' then return false; end if;  -- too late: already preparing / ready / done / void
  if o.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it

  update public.orders set status = 'void' where id = p_order;

  -- A card-paid order that's canceled needs a refund in Square — all of what the card was charged (0409). One alert
  -- per order, the Pass's kind: Marked refunded on its card.
  if o.paid then
    perform public.alert_open_once('refund_needed', o.id, 'critical', 'money',
      'Customer canceled a paid order — refund needed',
      'A member canceled order #' || upper(substr(o.id::text, 1, 4)) || '. Refund '
        || public.refund_words(o.total_cents, o.tip_cents) || ' in Square — all of the charge.',
      '/crew?s=money&a=pay');
  end if;
  return true;
end $$;
revoke all on function public.cancel_own_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_order(uuid) to authenticated;

-- ── a guest's cancel, from the ticket (0396's, the alert restated) ────────────────────────────────────────────────────
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
    perform public.alert_open_once('refund_needed', o.id, 'critical', 'money',
      'Customer canceled a paid order — refund needed',
      v_who || ' canceled order ' || v_no || ' from its order page. Refund '
        || public.refund_words(o.total_cents, o.tip_cents) || ' in Square — all of the charge.',
      '/crew?s=money&a=pay');
  else
    insert into public.alerts (severity, category, title, body, link)
    values ('fyi', 'order', 'Canceled: ' || v_who || '''s cup order',
            v_who || ' canceled order ' || v_no || ' from its order page. Nothing was charged — no refund needed.',
            '/crew');
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'canceled', 'paid', coalesce(o.paid, false));
end $$;
revoke all on function public.cancel_by_ticket(uuid) from public, anon, authenticated;
grant execute on function public.cancel_by_ticket(uuid) to anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A canceled order is refunded in full — the tip too', 'fix', 'Ordering',
   'When a card-paid cup order is canceled — by you, from the app or its order page, or by the crew — the crew is told the whole amount the card was charged, the tip included, so that is what comes back. It used to name the drinks only.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select public.refund_words(1000, 150) = '$11.50 (drinks $10.00 + tip $1.50)';                              -- true
--   select prosrc like '%refund_words(o.total_cents, o.tip_cents)%' from pg_proc where proname = 'cancel_own_order'; -- true
--   select prosrc like '%refund_words(o.total_cents, o.tip_cents)%' from pg_proc where proname = 'cancel_by_ticket'; -- true
--   select has_function_privilege('anon', 'public.cancel_by_ticket(uuid)', 'execute');                          -- true
select public.record_migration('0409_money_back_is_all_of_it');
