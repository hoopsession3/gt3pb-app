-- ── A DEEP LINK NOTHING WAS CHECKING ───────────────────────────────────────────────────────────
-- 2026-09-29. 0329 shipped an alert pointing at a `shop` section. There is no such section. The
-- shop lives under `money`, in an accordion panel with the id `shoporders`, and that link quietly
-- redirects to the top of the money page — so the alert that exists to put a stalled paid order in
-- front of somebody dropped them at the top of a long page with no idea what they were looking for.
-- (The broken string is deliberately not written out below: this file is now read by that check.)
--
-- lib/records.ts wrote the rule down before I broke it: "A link that half-works is worse than one
-- that plainly does not."
--
-- ── WHY THE GATE THAT EXISTS DID NOT CATCH IT ──────────────────────────────────────────────────
-- The smoke suite already reads every /crew?s= link against OperatorNav's real section list and
-- against the ids in the JSX. It caught this instantly — in app/api/square/webhook/route.ts, while
-- 0330 was being written. It did NOT catch 0329, because it walks app/, components/ and lib/ and
-- migrations are none of those.
--
-- So the rule was right, its reach was wrong, and the half of the app that produces the most alerts
-- — pg_cron functions in SQL — was the half nobody was reading. That is fixed in the same commit
-- as this, in scripts/smoke.cjs, from 0331 forward.
--
-- This migration fixes the damage already applied: the function, and the alert row it has already
-- written into Ryan's inbox.

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
        '/crew?s=money&a=shoporders', 'shop_order_stalled', r.id, now()
      );
      raised := raised + 1;
    end if;
  end loop;
  return raised;
end $$;

-- The alert 0329 already raised is carrying the broken link. Fixing the function does not fix a row
-- that is already in the inbox, and that row is about a real paid order somebody still has to act on.
-- Matched on "is not the right link" rather than on the one wrong value it happens to hold. That
-- fixes any other wrong link of this kind too, and it keeps the broken string from living on in a
-- file the deep-link check now reads.
update public.alerts
   set link = '/crew?s=money&a=shoporders'
 where kind = 'shop_order_stalled'
   and coalesce(link, '') <> '/crew?s=money&a=shoporders';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The stalled-order alert now opens the order','fix','Shop',
   'The alert added yesterday for a paid order that has stopped moving linked to a page section that does not exist, so tapping it landed you at the top of the money page instead of on the order. It now opens the shop orders panel directly, and the alert already sitting in the inbox was corrected too.',
   '2026-09-29', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0331_a_deep_link_nothing_was_checking',
  'shop_order_stall_watchdog re-emitted with a link that exists. 0329 pointed the alert at a section named shop; there is no such section — the shop is a panel (shoporders) inside money — so the alert raised to put a stalled paid order in front of somebody dropped them at the top of an unrelated page. The smoke suite already checks every /crew?s= link against OperatorNav and the JSX ids, and caught the same mistake in the Square webhook within the hour; it missed 0329 because it walked app/, components/ and lib/ and not supabase/migrations/. Reach fixed in the same commit. The alert row already in the inbox is updated too, because fixing the function does not fix a row already written.');

-- verify:
--   select kind, link from public.alerts where kind = 'shop_order_stalled';
--   -- every row must read /crew?s=money&a=shoporders
