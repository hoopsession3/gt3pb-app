-- ── A PAID ORDER CAN STOP MOVING AND NOBODY HEARS ──────────────────────────────────────────────
-- 2026-09-29. Apliiq emailed Ryan: "your customer []'s order #23ac3494… cannot be imported.
-- Therefore the order will not be fulfilled." Cause, measured rather than assumed — his Apliiq pay
-- methods page is empty, no card on file for the dropship charge, exactly what their email named.
--
-- The money was already collected. Square cleared $32. And this app did not know, and had no way of
-- knowing, because of where the status comes from:
--
--   app/api/shop/checkout   on submit.ok  →  status = 'submitted'
--
-- `submit.ok` means a POST to Apliiq returned 200 with an id. Their importer runs AFTERWARDS, on
-- their clock, and can refuse the order — and when it does, it emails the account owner. There is no
-- rejection webhook: /api/apliiq/fulfillment carries shipping and nothing else. So the last thing
-- this app ever learns about an order is that it was sent.
--
-- The panel then asserted "Accepted by printer · Apliiq has taken it" for twelve hours about an
-- order Apliiq had explicitly refused, and the only thing that broke the silence was a human reading
-- his personal email on a phone.
--
-- ── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────────
-- It cannot detect the rejection. Nothing here can, until Apliiq exposes one. What it CAN do is stop
-- treating "no news" as "fine": an order the app says is waiting on US, that has not moved in a day,
-- is a fact this database already holds and nobody was reading.
--
-- The condition is not re-derived here. v_shop_orders already owns "who is waiting on this order"
-- (waiting_on_us) and "how long has it sat" (age_hours) — 0328 exists because that fact had drifted
-- into two homes once already. This reads the view. If the definition of waiting-on-us changes, this
-- changes with it, and there is nothing to keep in sync.
--
-- NOT to be confused with 0120's alert_stale_orders(), which watches public.ORDERS — the café tickets
-- on the kitchen pass, on a ten-minute clock. Two different tables called orders, two different
-- businesses. This one is merch.
--
-- ── WHY CRITICAL, WHEN 0327 JUST SPENT ITSELF ARGUING THE OPPOSITE ─────────────────────────────
-- 0327 downgraded the heartbeat alert because twenty criticals about a non-event taught an owner to
-- scroll past the word. The distinction is not "how bad does it sound" — it is what has to be true
-- for the alert to exist at all:
--
--   heartbeat_stale    fires because a cron job ran and a timestamp was old. Rate limited by the
--                      cron schedule, which is to say not at all. Nobody was harmed.
--   shop_order_stalled cannot fire unless a REAL CUSTOMER really paid and really was not served.
--                      Its rate is bounded by the number of paid orders, and today that is one.
--
-- An alert that can only exist when somebody has been taken money from and given nothing is what the
-- word critical is for. If this ever becomes noise it will be because the shop is broken, and that is
-- the correct time to be noisy.
--
-- ── WHY THE COUNTER STAYS AT ONE ───────────────────────────────────────────────────────────────
-- 0327 added alerts.occurrences so a recurring condition folds into one line with a tally. That is
-- the right shape for an episodic condition. This one is not episodic: an order that is stuck stays
-- stuck, continuously, and there is no second occurrence to count while it remains the same stall.
-- Incrementing on every cron run would put 48 a day on a single order and reproduce the exact flood
-- 0327 removed, in a new place.
--
-- So a still-stalled order refreshes last_seen_at and its body — the useful number is the AGE, which
-- the body carries and which grows on its own. occurrences stays 1 and means what it says.

create or replace function public.shop_order_stall_watchdog(stale_hours int default 24)
  returns int language plpgsql security definer set search_path = public as $$
declare
  r        record;
  open_id  uuid;
  raised   int := 0;
begin
  -- greatest(...,1) so a mistaken 0 cannot turn this into "alert on every order the moment it is paid".
  for r in
    select o.id, o.who, o.status, o.age_hours, o.total_cents, o.items
      from public.v_shop_orders o
     where o.waiting_on_us
       and o.age_hours >= greatest(stale_hours, 1)
     order by o.age_hours desc
  loop
    -- ONE open alert per ORDER, not per condition — subject_id is what makes two stalled orders two
    -- lines instead of one that keeps overwriting itself. Once acknowledged, a later stall of the
    -- same order opens a fresh alert: an owner who cleared it is asking to be told again.
    select a.id into open_id
      from public.alerts a
     where a.kind = 'shop_order_stalled'
       and a.subject_id = r.id
       and a.ack_at is null
     order by a.created_at desc
     limit 1;

    if open_id is not null then
      -- Still stuck. Same episode: refresh what it says, leave the tally alone (see above).
      update public.alerts
         set last_seen_at = now(),
             body = r.who || ' paid ' || to_char((coalesce(r.total_cents, 0) / 100.0), 'FM999990.00')
                    || ' for ' || coalesce(r.items, 'this order') || ' and it has not moved in '
                    || r.age_hours || ' hours. Status is "' || r.status || '", which means this app '
                    || 'sent it and heard nothing since — not that the printer accepted it. Apliiq '
                    || 'refuses orders by EMAIL to the account owner; nothing about a refusal ever '
                    || 'reaches here. Open Apliiq and confirm this order actually exists there.'
       where id = open_id;
    else
      insert into public.alerts (severity, category, title, body, link, kind, subject_id, last_seen_at)
      values (
        'critical', 'order',
        'A paid order has not moved in ' || r.age_hours || ' hours',
        r.who || ' paid ' || to_char((coalesce(r.total_cents, 0) / 100.0), 'FM999990.00')
          || ' for ' || coalesce(r.items, 'this order') || ' and it has not moved in '
          || r.age_hours || ' hours. Status is "' || r.status || '", which means this app sent it '
          || 'and heard nothing since — not that the printer accepted it. Apliiq refuses orders by '
          || 'EMAIL to the account owner; nothing about a refusal ever reaches here. Open Apliiq and '
          || 'confirm this order actually exists there.',
        '/crew?s=shop', 'shop_order_stalled', r.id, now()
      );
      raised := raised + 1;
    end if;
  end loop;
  return raised;
end $$;

revoke all on function public.shop_order_stall_watchdog(int) from public, anon, authenticated;

-- Every 30 minutes. The condition is measured in hours, so a tighter schedule buys nothing and only
-- adds runs. Idempotent; guarded so the migration still applies where pg_cron is not enabled (PGlite).
do $$ begin
  perform cron.schedule('shop-order-stall-watchdog', '*/30 * * * *',
                        'select public.shop_order_stall_watchdog(24)');
exception when others then null; end $$;

comment on function public.shop_order_stall_watchdog(int) is
  'Raises ONE critical alert per merch order that v_shop_orders says is waiting on us and has not moved in stale_hours (default 24). Exists because the app cannot learn that Apliiq refused an order — they email the account owner and there is no rejection webhook — so "no news" had to stop meaning "fine". Not public.orders: that is the cafe pass, watched by 0120.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A paid order that stops moving now says so','fix','Shop',
   'The first cap was paid for, sent to the printer, and refused by them — and the only notice was an email to Ryan''s phone a day later, while the shop panel still read "Accepted by printer". The app is never told when the printer refuses an order, so it now watches the clock instead: any paid order that has not moved in a day raises a critical alert naming the customer, the amount, and how long it has sat. The status wording was corrected too — it says the order was sent, because that is the last thing this app actually knows.',
   '2026-09-29', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0329_a_paid_order_can_stop_moving_and_nobody_hears',
  'shop_order_stall_watchdog(). Apliiq refused the first paid cap ("cannot be imported… will not be fulfilled") and told Ryan by email; nothing reaches the app, whose status only ever meant "our POST returned 200". So a paid order sat twelve hours under "Accepted by printer" with nobody able to see it. Reads v_shop_orders rather than re-deriving waiting-on-us (0328 was that mistake). Critical on purpose, unlike 0327''s downgrade: this cannot fire unless a real customer really paid and really was not served. occurrences stays 1 — a continuous stall is one episode, and counting cron runs would rebuild 0327''s flood in a new place.');

-- verify:
--   select public.shop_order_stall_watchdog(24);   -- twice: the second must NOT add a row
--   select title, severity, occurrences, last_seen_at, subject_id
--     from public.alerts where kind = 'shop_order_stalled' order by created_at desc;
--   select id, status, waiting_on_us, age_hours from public.v_shop_orders order by created_at desc;
