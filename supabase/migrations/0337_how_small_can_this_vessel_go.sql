-- ── HOW SMALL CAN THIS VESSEL GO ──────────────────────────────────────────────────────────────
-- 2026-10-01. Ryan: "Recipe should be able to scale down as small as possible to not waste and
-- expand as needed." Asked how small: "Start at 3 servings 30OZ." Asked how to handle the vessel's
-- own minimum, which nobody has ever measured: "Add the column, I'll measure."
--
-- This is that column, and it is the one lib/brewMath's vesselFit already asked for in writing on
-- 2026-09-07:
--
--     "TOO SMALL is NOT a fact and this does not pretend it is. The real minimum depends on where
--      the basket sits, which is not recorded anywhere and which I have not measured. A third of
--      capacity is a prompt to go and look at the vessel, not a specification of it... If the true
--      minimum is ever measured it belongs on brew_vessels as a column, and this heuristic should
--      be deleted the day it is."
--
-- The heuristic is not deleted here, because deleting it today would leave BOTH vessels with no
-- minimum at all — the column ships empty and stays empty until somebody goes and measures. What
-- changes is precedence: a measured minimum wins, and the capacity/3 guess applies only while the
-- column is null, saying so in the copy. The day both rows carry a number, the guess is dead code
-- and can go.
--
-- ── WHY NULLABLE, WITH NO DEFAULT ──────────────────────────────────────────────────────────────
-- Because "not measured" and "measured at zero" are different facts and a default would merge them.
-- A default of capacity/3 would be the guess again, written into the database where it would look
-- like a measurement and outlive the comment explaining that it was not one. Null means nobody has
-- looked, the app says so, and nothing is blocked.
alter table public.brew_vessels add column if not exists min_gal numeric;

-- A minimum at or above capacity is not a minimum, it is a broken row — and it would make every
-- batch in that vessel read as too small, forever, with no way to tell why. Caught here rather than
-- in a form, because the form is not the only thing that writes rows.
alter table public.brew_vessels drop constraint if exists brew_vessels_min_under_capacity;
alter table public.brew_vessels
  add constraint brew_vessels_min_under_capacity
  check (min_gal is null or (min_gal > 0 and min_gal < capacity_gal));

comment on column public.brew_vessels.min_gal is
  'The smallest batch this vessel can actually brew, in gallons — MEASURED, never estimated. For a basket vessel it is the volume at which the liquid first reaches the filter basket; for a bag vessel it is the volume that covers the bag. NULL means nobody has measured it yet, which is a different fact from zero and must stay distinguishable: lib/brewMath.vesselFit falls back to a capacity/3 PROMPT only while this is null, and the prompt is meant to be retired once every vessel carries a real number. Half a gallon in the 5 gal Cold Brew Avenue is the batch that started this — correct arithmetic, not brewable.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Batches can be planned small without wasting coffee','fix','Brew',
   'Planning a batch used to round it up to the nearest quarter gallon, which quietly threw away up to three servings of coffee on every single brew — ask for three servings and it would brew five. Batches now round to a much finer step, so what you ask for is what you make. The smallest batch is three servings, worked out through each recipe''s own yield so that three servings means three actually come out. Each vessel can also record the smallest batch it can physically brew, once that has been measured.',
   '2026-10-01', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0337_how_small_can_this_vessel_go',
  'brew_vessels.min_gal — the measured smallest batch a vessel can brew, nullable with no default because "not measured" and "zero" are different facts. Delivers the column vesselFit asked for in writing on 2026-09-07 ("if the true minimum is ever measured it belongs on brew_vessels as a column"). The capacity/3 heuristic is NOT deleted yet: the column ships empty, so deleting it today would leave both vessels with no minimum at all. Precedence instead — a measured minimum wins, the guess applies only while null, and the guess becomes dead code the day Toddy and Cold Brew Avenue both carry a number. CHECK refuses a minimum at or above capacity, which would make every batch in that vessel read as too small forever. Shipped with the app-side change Ryan asked for: gallonsForBottles rounded up to 0.25 gal and wasted up to 2 bottles at EVERY size (3 bottles requested brewed 0.5 gal and made 5, 67% over); the step is now 0.05 gal and the waste is 0 across counts 1-120 at four yield factors. The floor is 3 servings computed THROUGH the yield — 30 oz of water at a 0.92 yield pours 27.6 oz, which is two servings, so a 30 oz floor would have handed somebody who asked for three a batch that makes two.');

-- verify:
--   select name, capacity_gal, min_gal, filter_type from public.brew_vessels order by sort;
--   -- both min_gal are NULL until measured; the app says so rather than guessing
--   update public.brew_vessels set min_gal = capacity_gal where name = 'Toddy (commercial)';  -- must FAIL
--   select conname from pg_constraint where conrelid = 'public.brew_vessels'::regclass and conname like '%min_under%';
