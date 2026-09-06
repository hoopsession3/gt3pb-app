-- 0297 — The readiness board was reading the wrong column for "is it live".
--
-- 0285 made markets.is_live NULLABLE ON PURPOSE: null means "inherit the company-wide switch", and
-- market_live is the view that does the coalesce. 0296's Launch check read markets.is_live raw, so
-- both cities — which each carry null and inherit — came back as 'unknown', reported to the owner as
-- "Not live, and no opening date has been set."
--
-- Two things wrong with that. It called a question unanswered when the answer was sitting one view
-- away, and 'unknown' is the status this board reserves for "nobody has told the app yet". Spending
-- it on a case the app knows perfectly well devalues it everywhere else it appears: the Toddys that
-- genuinely have not been recorded now read the same as a switch that is simply off.
--
-- The resolved answer today is false for both markets, because the company-wide switch is off. That
-- is evidence, so it blocks rather than shrugs. Found by reading the live board rather than by a
-- test, which is the second defect this session that only showed up when the output was looked at —
-- so the test added alongside this one asserts against the RESOLVED value, not the raw column.

create or replace view public.v_market_readiness as
with mk as (
  select m.slug, m.name, m.state, m.opens_on,
         -- The resolved switch, never the raw column: null on the market means inherit.
         coalesce(ml.is_live, false) as is_live
    from public.markets m
    left join public.market_live ml on ml.market = m.slug
   where coalesce(m.active, true))

select m.slug as market, 'Launch' as area, 'Storefront switched on' as check_name,
       case when m.is_live then 'ready' else 'blocked' end as status,
       case when m.is_live then 'Live and taking orders.'
            when m.opens_on is not null
              then 'Not live yet — held until ' || to_char(m.opens_on, 'Mon FMDD, YYYY') || '.'
            else 'Not live. The company-wide switch is off and this market has no override.' end as detail,
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
 group by m.slug;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The readiness board reads the storefront switch correctly','fix','Plan',
   'A market can leave its storefront switch unset and inherit the company-wide one. The new readiness board read the market''s own setting instead of the resolved answer, so both cities reported that nobody had said whether they were live — when the app knew the answer all along. It now reports the resolved state, and reserves "unknown" for the things genuinely nobody has recorded yet.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select market, status, detail from public.v_market_readiness
--    where check_name = 'Storefront switched on';
