-- ── 0364 — A SHELF THAT NEVER EXISTED HOLDS NOTHING ──────────────────────────────────────────────────
-- 2026-10-11 (Ryan's Readiness screenshot: ON HAND NOW listed −420, −1.5 and −24). Those are the three
-- draw-downs 0294 found and marked: the first brews logged what they used under the RECIPE's words
-- ('Coarse-ground organic single-origin coffee', water, coconut water) before a recipe could find a
-- shelf, so each came off a shelf that was never stocked. 0294 kept them and marked them [orphan:…],
-- because the ledger is a record of what was believed at the time. That stays true here: nothing is
-- deleted or edited (0308 blocks deleting a ledger row, and it should).
--
-- What is wrong is what the balance SAYS. inventory_on_hand sums the ledger per (item, market), so each
-- orphan surfaces as a shelf holding a negative amount — on the load-out screen, to the person deciding
-- what to pack, as a count to "correct". There is no shelf to count. The ledger already has the word for
-- this correction, 'adjust': one row per orphan, the exact opposite of its sum, saying why. The balance
-- then reads 0, and the screen (which lists only non-zero balances) stops showing it.
--
-- Scope — only a group that is NOTHING BUT orphan draw-downs: no inventory item carries its name in that
-- market, and every one of its rows is a 'use' that 0294 marked. A real shelf, or an orphan somebody has
-- since corrected or restocked by hand, is left exactly as it is. Running this twice changes nothing: the
-- adjust row it writes breaks the "nothing but" test, and the sum is already 0.
-- changelog: below.

insert into public.inventory_ledger (item, market, tenant_id, kind, qty, note)
select l.item, l.market, l.tenant_id, 'adjust', -sum(l.qty),
       '0364: brings to zero a draw-down written before a recipe could find a shelf (0294 marked it an orphan). No shelf has this name, so nothing was ever on hand to take it from.'
  from public.inventory_ledger l
 where not exists (select 1 from public.inventory_items i where i.name = l.item and i.market = l.market)
 group by l.item, l.market, l.tenant_id
having bool_and(l.kind = 'use' and coalesce(l.note, '') like '%[orphan:%')
   and sum(l.qty) <> 0;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Readiness stops listing three shelves that never existed','fix','Prep',
   'The load-out screen''s On hand now list showed coffee at −420, water at −1.5 and coconut water at −24. Those came from the first brews, which logged what they used under the recipe''s own names before a recipe could find a real shelf, so they were taken from shelves that were never stocked. Each now has a correction that brings it back to zero, with the reason written on it, and the original entries stay in the history. Real shelves are untouched.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select item, market, on_hand from public.inventory_on_hand where on_hand < 0;      -- the three orphans are gone
--   select item, market, qty from public.inventory_ledger where note like '0364:%';    -- one adjust per orphan, +420 / +1.5 / +24
select public.record_migration('0364_a_shelf_that_never_existed_holds_nothing');
