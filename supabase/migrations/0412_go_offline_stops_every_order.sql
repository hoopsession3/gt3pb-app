-- ── 0412 — GO OFFLINE STOPS EVERY ORDER: A CITY'S SWITCH HOLDS IT CLOSED, AND NEVER KEEPS IT OPEN ────────────────
-- 2026-10-15. R7 of the customer re-audit (Ryan, 2026-10-15: "Keep working to improve to a 10"). Paste into Supabase →
-- SQL Editor → Run. A second run changes nothing.
--
-- WHY. Whether a city takes orders is market_live (0285): the city's own switch (markets.is_live) when it has one, else
-- the truck's (live_status — Live Ops' Go live and Go offline). The city's switch won. So once an owner had put a city
-- "live" from Settings › Locations & markets — an easy tap: a city that follows the truck showed "Not live" there — Go
-- offline cleared the truck and the city stayed live: with no stop to pour at, Pay took cards ("Ready in ~8 min", "At
-- the truck") while Live Ops said the truck was off the road, Find Us said it wasn't live and the concierge said it was
-- closed — until an owner found the city's switch and turned it off. An admin, who may Go offline, could not.
--
-- WHAT. A city's switch can hold it closed (false), and nothing more: null — and true, as an owner may have left it —
-- follow the truck. Taking orders is the truck live AND the city not held closed AND its opening day reached. Every
-- column of the view is 0285's, in its order; only is_live's rule changes. A city that runs its own truck one day
-- needs its own live pointer too (lib/orderingRead says so) — the day it does, its switch can mean "open" again.
-- changelog: below.

create or replace view public.market_live as
select m.slug                                                    as market,
       ((m.is_live is distinct from false)
         and coalesce(ls.is_live, false)
         and (m.opens_on is null or m.opens_on <= current_date))  as is_live,
       coalesce(m.preorder_lead_h, ls.preorder_lead_h, 4)         as preorder_lead_h,
       coalesce(m.pay_at_pickup,   ls.pay_at_pickup,   true)      as pay_at_pickup,
       m.opens_on,
       (m.opens_on is not null and m.opens_on > current_date)     as pre_launch
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;

-- security_invoker: market_live — definer on purpose, as 0285 made it: markets is the crew's to read (its RLS is staff
-- only), and a signed-out menu has to know whether its city is taking orders. The view carries that answer and the
-- checkout's own settings — the lead time, pay at pickup, the opening day — and nothing else of a city.
revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

comment on view public.market_live is
  'Is this city taking orders right now (0412): the truck is live (live_status — Live Ops'' Go live and Go offline), the city is not held closed (markets.is_live = false), and its opening day has come. A city''s switch holds it closed and never keeps it open.';
comment on column public.markets.is_live is
  'False holds this city closed whatever the truck does (0412). Null — or true, which reads the same — follows the truck: Go live and Go offline are every city''s until a city runs its own truck with its own live pointer.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Go offline stops every order', 'fix', 'Service',
   'Going offline in Live Ops now stops orders in every city it serves, every time. A city''s own switch in Settings › Locations & markets can hold that city closed; it can no longer keep a city taking orders while the truck is off the road.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_viewdef('public.market_live'::regclass) like '%IS DISTINCT FROM false%';                       -- true
--   select count(*) from public.market_live ml join public.live_status ls on true where ml.is_live and not ls.is_live; -- 0
--   select has_table_privilege('anon', 'public.market_live', 'select');                                           -- true
select public.record_migration('0412_go_offline_stops_every_order');
