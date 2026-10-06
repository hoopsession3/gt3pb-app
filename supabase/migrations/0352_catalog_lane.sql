-- ── WHAT THE BUSINESS SELLS HAS A SECTION OF ITS OWN ───────────────────────────────────────────────
-- 2026-10-06, the settings-by-category round. Ryan asked whether Settings was organized by category,
-- to the industry standard. It was not: a third of its rows were things the business sells or says,
-- which a store's admin keeps out of its settings. The menu, merch, lessons, membership plans,
-- discount codes and founding perks are the Catalog section now (app/crew/page.tsx), beside Money;
-- Settings holds only how things behave (lib/settingsLayout).
--
-- A section is reached from its lane's row of tabs, and the lanes are rows of work_streams (0159). So
-- the Business lane gains 'catalog', right after 'money' — the order DEFAULT_STREAMS (lib/streams.ts)
-- lists. Idempotent by guard (re-running adds nothing), scoped by key, and a lane a tenant reshaped
-- without Money gains it at the end rather than not at all. Who may OPEN the section is the app's
-- (owners and admins: components/OperatorNav ROLE_SECTIONS); the panels in it write what they wrote
-- before, under the policies they had (0351: owner or admin).

update public.work_streams
   set sections = case
     when 'money' = any(sections)
       then sections[1:array_position(sections, 'money')] || array['catalog']::text[] || sections[array_position(sections, 'money') + 1:]
     else array_append(sections, 'catalog')
   end
 where key = 'business' and not ('catalog' = any(sections));

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Settings by category, and a Catalog for what we sell','improvement','Crew',
   'Settings reads the way a phone''s Settings does: You (your account, notifications, display), Business (payments, ordering & delivery, locations, team, reports, integrations, AI, brand) and Advanced — one row per topic. What the business sells — the menu, merch, lessons, membership plans, codes and perks — moved to its own Catalog section beside Money, broadcasts moved to Customers › Messages, and the changelog is What''s new in the Guide. Every old link still lands.',
   '2026-10-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select key, sections from public.work_streams where key = 'business';   -- 'catalog' right after 'money'
select public.record_migration('0352_catalog_lane');
