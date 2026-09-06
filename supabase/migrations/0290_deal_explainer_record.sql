-- 0290 — THE RECORD FOR A CHANGE THAT NEEDED NO SCHEMA. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The deal explainer is entirely app code: lib/dealExplainer.ts and components/DealExplainer.tsx,
-- reading columns 0287 and 0289 already added. There is nothing to migrate.
--
-- It gets a file anyway, and only for this reason: the changelog is how anyone reconstructs what
-- shipped and when, and a feature that changes what an operator sees before they sign is exactly
-- the kind of thing that should not be missing from it. A migration that inserts one row is a small
-- price for the record being complete.
--
-- Apply after 0289. Safe to run at any time — it writes one changelog row and nothing else.

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Operators can see what they are signing','improvement','Operators',
   'An operator being offered a market can now open their own agreement and work through it: move the supply-funding slider, the revenue and the amount each side puts in, and watch what it does to their share, what they take home, what they have to clear before they earn anything, and how long their own money takes to come back. The controls are honest in both directions — if a position pays them nothing, it says so, and it points out when a different position would pay them more. Nothing they move changes the offer; if they prefer a different position there is a button that sends it back as a counter, already written out. The ladder of tiers above them and the list of what accepting actually locks in are on the same screen.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   select title, area, shipped_on from public.changelog order by id desc limit 3;
