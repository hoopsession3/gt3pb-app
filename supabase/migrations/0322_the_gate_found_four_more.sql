-- THE GATE FOUND FOUR MORE, ON ITS FIRST RUN.
--
-- 0321 restored three views the app had started reading and fixed what I could see. Then the check
-- it shipped alongside — v_invoker_view_gaps — was run for the first time and returned four rows:
--
--   v_market_readiness -> v_item_kind_gaps
--   v_market_readiness -> v_market_crew
--   v_market_readiness -> v_recipe_ingredient_gaps
--   v_market_readiness -> v_unaccounted_batches
--
-- All four are in 0312's revoke list. All four are relations v_market_readiness selects from. So
-- the Markets panel would STILL have been broken after 0321, in exactly the way 0321 was written
-- to fix, and I would have shipped a fix that did not fix it and said so in a commit message.
--
-- This is the second time in two days a rule caught a case its author had missed within minutes of
-- being written — scripts/gate.audit.mjs found a fifth broken auth gate the same way. The lesson is
-- not that the rules are clever. It is that a sweep only ever finds what somebody thought to look
-- for, and four levels of view dependency is past what anybody holds in their head.
--
-- ── WHY GRANTING THESE IS NOT A LEAK ───────────────────────────────────────────────────────────
-- All four are currently DEFINER views (no reloptions at all), which is why granting them as they
-- stand would be precisely the side door 0312 closed: a definer view runs as its owner and hands
-- the caller rows the base tables' RLS would have refused.
--
-- So each gets security_invoker FIRST, and the grant second. Under invoker, the policies on
-- inventory_items, profiles, recipes and brew_batches are what decide — and those are staff-gated.
-- A signed-in customer querying any of these gets zero rows, not a leak. The grant adds reach the
-- base tables already govern, which is the whole design 0312 established.
--
-- v_market_crew is the one worth naming explicitly: it lists crew with their market and whether a
-- lead may change their role. Under invoker it inherits profiles' policy, so it tells a member
-- exactly what profiles would have told them, which is what 0312's own header says the fix is for.

alter view public.v_item_kind_gaps         set (security_invoker = on);
alter view public.v_market_crew            set (security_invoker = on);
alter view public.v_recipe_ingredient_gaps set (security_invoker = on);
alter view public.v_unaccounted_batches    set (security_invoker = on);

grant select on public.v_item_kind_gaps         to authenticated;
grant select on public.v_market_crew            to authenticated;
grant select on public.v_recipe_ingredient_gaps to authenticated;
grant select on public.v_unaccounted_batches    to authenticated;

comment on view public.v_market_crew is
  'Crew by market, with whether a market lead may change each role. Reachable by the app since 2026-09-09 because v_market_readiness selects from it; security_invoker so profiles'' own RLS still decides who appears.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
-- No changelog entry: 0321 already told the owner the two screens were fixed, and this is the same
-- fix finishing. A second "we fixed it again" line in the product changelog would be noise about
-- our process rather than news about their business.
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The overdue list and the Markets panel actually load now','fix','Command',
   'Both shipped yesterday and both failed the moment they opened: the database views they read had been closed to the app months earlier, back when nothing read them. Restored, with the row-level rules still in charge of who sees what — and there is now a standing check that refuses to let a screen ship pointing at data the app is not allowed to read, including the indirect case where the view you name is fine and something underneath it is not.',
   '2026-09-09', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0322_the_gate_found_four_more',
  'v_invoker_view_gaps returned four rows on its first run: v_market_readiness selects from v_item_kind_gaps, v_market_crew, v_recipe_ingredient_gaps and v_unaccounted_batches, all revoked by 0312 and all still definer. Each set to security_invoker and granted, so the Markets panel can actually read what it renders and the base tables keep deciding who sees what.');

-- verify:
--   select * from public.v_invoker_view_gaps;   -- expect ZERO rows, and it means it this time
