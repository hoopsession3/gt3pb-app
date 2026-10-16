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
-- column of the view is 0285's, in its order; only is_live's rule changes — and one column more, at the end: held_closed,
-- the city's switch at false. Held closed is closed to every order, not only the "truck is live" kind: a stop under way
-- that nobody flipped live, and a stop's pre-order window, are open on their own (lib/ordering), and the ordering read
-- closes them for a held city — or one whose opening day has not come — with this. A city that runs its own truck one day
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
       (m.opens_on is not null and m.opens_on > current_date)     as pre_launch,
       (m.is_live is not distinct from false)                     as held_closed
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;

-- ── the readiness board's storefront check (0297's view, its first check only) ────────────────────────────────────
-- 0297 read market_live.is_live for "Storefront switched on", a blocking launch check — which, with is_live now the
-- truck's switch too, would block every city whenever the truck is offline and say "the company-wide switch is off and
-- this market has no override" of a city set to follow it. The check asks what a launch needs: the city is not held
-- closed and its day has come. Every other check is 0297's, word for word; security_invoker as 0321 set it.
create or replace view public.v_market_readiness with (security_invoker = on) as
with mk as (
  select m.slug, m.name, m.state, m.opens_on,
         -- Whether this city can take orders at all (0412): not held closed, and its opening day come. Whether the truck
         -- is live right now is Live Ops' to say, every hour of every day — not a launch check's.
         coalesce(ml.held_closed, false) as held,
         coalesce(ml.pre_launch, false)  as pre
    from public.markets m
    left join public.market_live ml on ml.market = m.slug
   where coalesce(m.active, true))

select m.slug as market, 'Launch' as area, 'Storefront switched on' as check_name,
       case when m.held or m.pre then 'blocked' else 'ready' end as status,
       case when m.held then 'Held closed in Settings › Locations & markets — no orders here until it is let go.'
            when m.pre
              then 'Not live yet — held until ' || to_char(m.opens_on, 'Mon FMDD, YYYY') || '.'
            else 'Takes orders whenever the truck is live (Live Ops).' end as detail,
       true as blocking
  from mk m

union all
select m.slug, 'Crew', 'Someone leads this market',
       case when count(c.id) > 0 then 'ready' else 'blocked' end,
       case when count(c.id) > 0
            then string_agg(coalesce(c.display_name, 'unnamed'), ', ') || ' leads it.'
            else 'No lead. Set one with set_market_lead so role changes and equity have an owner.' end,
       true
  from mk m
  left join public.v_market_crew c on c.leads_market = m.slug
 group by m.slug

union all
select m.slug, 'Compliance', 'Critical rules confirmed',
       -- count(f.id), never count(*): this is a LEFT JOIN, so a market with no matching rule still
       -- produces one row and count(*) would report 1. Counting the joined column is what makes
       -- "nothing recorded" distinguishable from "recorded and failing", which is the whole point.
       case when count(f.id) = 0 then 'unknown'
            when count(f.id) filter (where f.freshness <> 'fresh') > 0 then 'blocked'
            else 'ready' end,
       case when count(f.id) = 0
            then 'No critical rules recorded for ' || coalesce(m.state, 'this state') || ' at all.'
            when count(f.id) filter (where f.freshness <> 'fresh') > 0
            then count(f.id) filter (where f.freshness <> 'fresh')::text || ' of ' || count(f.id)::text ||
                 ' need re-checking: ' || string_agg(f.label, '; ') filter (where f.freshness <> 'fresh')
            else 'All ' || count(f.id)::text || ' confirmed within the last six months.' end,
       true
  from mk m
  left join public.v_compliance_freshness f
         on f.critical and (f.state = m.state or f.state is null)
 group by m.slug, m.state

union all
select m.slug, 'Prep', 'Every recipe line can be drawn',
       case when count(g.ingredient) = 0 then 'ready' else 'blocked' end,
       case when count(g.ingredient) = 0
            then 'Every ingredient in every live recipe resolves to a shelf here.'
            else count(g.ingredient)::text || ' cannot: ' || string_agg(g.ingredient, '; ') end,
       true
  from mk m
  left join public.v_recipe_ingredient_gaps g on g.market = m.slug
 group by m.slug

union all
select m.slug, 'Equipment', 'A vessel to brew in',
       case when coalesce(c.vessels, 0) > 0 then 'ready' else 'unknown' end,
       case when coalesce(c.vessels, 0) > 0
            then c.vessels::text || ' vessel(s); biggest single batch ' || c.largest_gal::text ||
                 ' gal, ' || c.total_gal::text || ' gal across all of them.'
            else 'No vessel recorded here. If the Toddys have arrived, add them so the planner knows the ceiling.' end,
       true
  from mk m
  left join lateral public.market_brew_capacity(m.slug) c on true

union all
select m.slug, 'Packaging', 'Bottles on the shelf',
       case when count(i.id) = 0 then 'unknown'
            when count(i.id) filter (where s.effective_on_hand > 0) > 0 then 'ready'
            else 'blocked' end,
       case when count(i.id) = 0 then 'No packaging item exists for this market.'
            when count(i.id) filter (where s.effective_on_hand > 0) = 0
            then 'Every packaging line is at zero.'
            else count(i.id) filter (where s.effective_on_hand > 0)::text || ' packaging line(s) in stock.' end,
       true
  from mk m
  left join public.inventory_items i on i.market = m.slug and i.kind = 'packaging'
  left join public.inventory_status s on s.name = i.name and s.market = i.market
 group by m.slug

union all
select m.slug, 'Prep', 'Ingredient shelves have stock',
       case when count(i.id) = 0 then 'unknown'
            when count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0) > 0 then 'blocked'
            else 'ready' end,
       case when count(i.id) = 0 then 'No ingredient shelves exist for this market yet.'
            when count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0) > 0
            then count(i.id) filter (where coalesce(s.effective_on_hand, 0) <= 0)::text || ' of ' ||
                 count(i.id)::text || ' at zero: ' ||
                 string_agg(i.name, '; ') filter (where coalesce(s.effective_on_hand, 0) <= 0)
            else 'All ' || count(i.id)::text || ' have stock.' end,
       true
  from mk m
  left join public.inventory_items i on i.market = m.slug and i.kind = 'ingredient'
  left join public.inventory_status s on s.name = i.name and s.market = i.market
 group by m.slug

union all
select m.slug, 'Prep', 'Every item says what kind it is',
       case when count(g.id) = 0 then 'ready' else 'blocked' end,
       case when count(g.id) = 0 then 'All items classified.'
            else count(g.id)::text || ' unclassified: ' || string_agg(g.name, '; ') end,
       false
  from mk m
  left join public.v_item_kind_gaps g on g.market = m.slug
 group by m.slug

union all
select m.slug, 'Prep', 'Every batch accounted for',
       case when count(u.batch_id) = 0 then 'ready' else 'blocked' end,
       case when count(u.batch_id) = 0 then 'Every batch says what it drank.'
            else count(u.batch_id)::text || ' batch(es) brewed without being fully logged.' end,
       false
  from mk m
  left join public.v_unaccounted_batches u on u.market = m.slug
 group by m.slug;;

-- security_invoker: market_live — definer on purpose, as 0285 made it: markets is the crew's to read (its RLS is staff
-- only), and a signed-out menu has to know whether its city is taking orders. The view carries that answer and the
-- checkout's own settings — the lead time, pay at pickup, the opening day, whether it is held closed — and nothing else of
-- a city.
revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

comment on view public.market_live is
  'Is this city taking orders right now (0412): the truck is live (live_status — Live Ops'' Go live and Go offline), the city is not held closed (markets.is_live = false), and its opening day has come. A city''s switch holds it closed and never keeps it open. held_closed: the switch at false — no orders here of any kind, a scheduled stop''s included (lib/orderingRead).';
comment on column public.markets.is_live is
  'False holds this city closed whatever the truck does (0412). Null — or true, which reads the same — follows the truck: Go live and Go offline are every city''s until a city runs its own truck with its own live pointer.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Go offline stops every order', 'fix', 'Service',
   'Going offline in Live Ops now stops orders in every city it serves, every time. A city''s own switch in Settings › Locations & markets can hold that city closed — no orders at all there, scheduled stops included — and it can no longer keep a city taking orders while the truck is off the road.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_viewdef('public.market_live'::regclass) like '%IS DISTINCT FROM false%';                       -- true
--   select count(*) from public.market_live ml join public.live_status ls on true where ml.is_live and not ls.is_live; -- 0
--   select has_table_privilege('anon', 'public.market_live', 'select');                                           -- true
--   select count(*) from information_schema.columns where table_name = 'market_live' and column_name = 'held_closed'; -- 1
select public.record_migration('0412_go_offline_stops_every_order');
