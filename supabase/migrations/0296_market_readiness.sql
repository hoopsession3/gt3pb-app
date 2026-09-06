-- 0296 — Can this city open?
--
-- Everything built over the last several migrations answers one narrow question each: is the stock
-- counted (0293), can a recipe find a shelf (0294), is the rule still fresh (0284), who leads this
-- market (0289), is the switch on (0285), what kind of thing is this (0295). The owner's actual
-- question — "what is the bare minimum to start GT3 in Atlanta, and what is still missing" — is none
-- of those on its own. It is all of them, per city, in one place.
--
-- So this is the same house move applied one level up: turn the gap into a query. Every row is one
-- check against one market, and a row's status is only ever 'ready', 'blocked', or 'unknown'.
--
-- WHY 'unknown' IS NOT 'blocked'. They fail differently and they are fixed differently. Atlanta has
-- no brew vessel recorded — that could mean the Toddys have not arrived, or that they are sitting in
-- the garage and nobody typed them in. Reporting that as 'blocked' would be a claim the data does not
-- support; reporting it as 'ready' would be worse. 'unknown' says the honest thing: nobody has told
-- the app, and until they do, this cannot be signed off.
--
-- WHY state IS A COLUMN AND NOT PARSED FROM region. compliance_rules is keyed by two-letter state.
-- markets.region is free text a human typed — 'Greenville, SC', 'Atlanta, GA' — and a readiness
-- check that decides which health department applies by splitting on a comma is a check that will
-- one day silently apply South Carolina's rules to a Georgia market. The two known values are set
-- explicitly here and any future market has to say its own.

alter table public.markets add column if not exists state text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'markets_state_ck') then
    alter table public.markets add constraint markets_state_ck
      check (state is null or state ~ '^[A-Z]{2}$');
  end if;
end $$;

update public.markets set state = 'SC' where slug = 'greenville' and state is null;
update public.markets set state = 'GA' where slug = 'atlanta'    and state is null;

comment on column public.markets.state is
  'Two-letter state, used to decide which compliance rules apply. Set explicitly rather than parsed out of region, which is free text.';

-- ── the readiness board ────────────────────────────────────────────────────────────────────────
-- NOTE FOR WHOEVER TOUCHES v_unaccounted_batches NEXT: this view reads it, so redefining that one
-- now means dropping this pair first, in this order — summary, readiness, then the batch views.
create or replace view public.v_market_readiness as
with mk as (select slug, name, state, is_live, opens_on from public.markets where coalesce(active, true))

-- Is the switch on, and is a date set if it is not?
select m.slug as market, 'Launch' as area, 'Storefront switched on' as check_name,
       case when coalesce(m.is_live, false) then 'ready'
            when m.opens_on is not null      then 'blocked'
            else 'unknown' end as status,
       case when coalesce(m.is_live, false) then 'Live and taking orders.'
            when m.opens_on is not null      then 'Held until ' || to_char(m.opens_on, 'Mon FMDD, YYYY') || '.'
            else 'Not live, and no opening date has been set.' end as detail,
       true as blocking
  from mk m

union all
-- Does anybody lead this market? An operator with no market, or a market with no operator, is the
-- shape that lets a city run with nobody accountable for it.
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
-- Compliance: critical rules for this state (plus any that carry no state, which apply everywhere)
-- that are unverified or have gone stale. Freshness is 0284's judgement, not re-derived here.
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
-- Can every recipe line come off a shelf in this city? 0294's gap list, counted per market.
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
-- Something to brew INTO. A city with no vessel is not blocked on evidence, it is unrecorded.
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
-- Something to pour into. Packaging is what turns a finished batch into a thing you can sell.
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
-- Ingredient shelves that exist but are empty. Distinct from the recipe check above: that one asks
-- whether a line can find a shelf at all, this one asks whether the shelf has anything on it.
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
-- Advisory, not blocking: an unclassified item still works, it just gets alerts it may not deserve.
select m.slug, 'Prep', 'Every item says what kind it is',
       case when count(g.id) = 0 then 'ready' else 'blocked' end,
       case when count(g.id) = 0 then 'All items classified.'
            else count(g.id)::text || ' unclassified: ' || string_agg(g.name, '; ') end,
       false
  from mk m
  left join public.v_item_kind_gaps g on g.market = m.slug
 group by m.slug

union all
-- Advisory: batches that finished without saying what they used. Never blocks an opening — it is
-- history, and the guard already stops new ones joining the list.
select m.slug, 'Prep', 'Every batch accounted for',
       case when count(u.batch_id) = 0 then 'ready' else 'blocked' end,
       case when count(u.batch_id) = 0 then 'Every batch says what it drank.'
            else count(u.batch_id)::text || ' batch(es) brewed without being fully logged.' end,
       false
  from mk m
  left join public.v_unaccounted_batches u on u.market = m.slug
 group by m.slug;

revoke all on public.v_market_readiness from public, anon;
grant select on public.v_market_readiness to authenticated;

comment on view public.v_market_readiness is
  'One row per check per city: what still stands between a market and opening. "unknown" means nobody has told the app yet, which is deliberately not the same as "blocked".';

-- One line per city, for the crew console header.
create or replace view public.v_market_readiness_summary as
select market,
       count(*) filter (where blocking and status = 'blocked') as blocked,
       count(*) filter (where blocking and status = 'unknown') as unknown,
       count(*) filter (where blocking and status = 'ready')   as ready,
       count(*) filter (where not blocking and status <> 'ready') as advisories,
       (count(*) filter (where blocking and status <> 'ready') = 0) as can_open
  from public.v_market_readiness
 group by market
 order by market;

revoke all on public.v_market_readiness_summary from public, anon;
grant select on public.v_market_readiness_summary to authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One page that answers whether a city can open','improvement','Plan',
   'Opening a new city means the storefront switch, the health-department rules for that state, an operator who leads it, ingredients that can actually come off a shelf, something to brew in, and something to pour into — each of which lived in a different corner of the app. They now answer together, one row per check per city, and a check can say it does not know rather than pretending. Nobody has to remember the list.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_market_readiness_summary;
--   select area, check_name, status, detail from public.v_market_readiness where market='atlanta';
