-- ── BONE BROTH, SAID PLAINLY ───────────────────────────────────────────────────────────────────
-- 2026-10-10. Ryan: "Simmered to order, take that shit off." The app's own copy lost the word in the
-- same commit (lib/menu.ts, lib/copy.ts, lib/academy.ts, components/GenerateDay.tsx, lib/eventbrief.ts).
-- These are the rows the seeds wrote, which the menu, Primal and the concierge read from the database:
--
--   products.what, .ingredients          0062   FORGE, HUNT and WILD on the menu and their drink sheets
--   primal_lessons.body                  0272   Primal › Ruminant Red Meat
--   primal_lesson_products.rationale     0272   the lesson's FORGE pairing
--   agent_knowledge.body                 0178   the concierge's bone-broth fact
--
-- Each update rewrites only the seeded phrase, and only where it is still there: a row the owner has
-- since reworded is left as he wrote it, and a second run changes nothing. The concierge also gets
-- the word on its MUST NOT list, so it doesn't bring it back from its own vocabulary.

-- "Slow-simmered, pasture-raised beef bone broth."  →  "Pasture-raised beef bone broth."
update public.products
   set what = 'Pasture-raised ' || substr(what, length('Slow-simmered, pasture-raised ') + 1)
 where slug in ('forge','hunt','wild') and what like 'Slow-simmered, pasture-raised %';

-- {"Slow-simmered beef bone broth","Pasture-raised"}  →  {"Beef bone broth","Pasture-raised"}, order kept.
update public.products p
   set ingredients = array(
         select case when u.i like 'Slow-simmered %'
                     then upper(substr(u.i, 15, 1)) || substr(u.i, 16)
                     else u.i end
           from unnest(p.ingredients) with ordinality as u(i, n)
          order by u.n)
 where p.slug in ('forge','hunt','wild')
   and exists (select 1 from unnest(p.ingredients) as x(i) where x.i like 'Slow-simmered %');

update public.primal_lessons
   set body = replace(body, 'Slow-simmered bone broth extends that', 'Bone broth extends that')
 where slug = 'ruminant-red' and body like '%Slow-simmered bone broth extends that%';

update public.primal_lesson_products
   set rationale = 'Beef bone broth - collagen and minerals for the rebuild.'
 where product_slug = 'forge'
   and rationale = 'Slow-simmered beef bone broth - collagen and minerals for the rebuild.';

update public.agent_knowledge
   set body = replace(body, 'bones and connective tissue slow-simmered for hours',
                            'bones and connective tissue cooked down for hours')
              || ' MUST NOT call the broth "simmered" or "slow-simmered".'
 where agent = 'concierge' and title = 'Ingredient · Bone broth'
   and body like '%slow-simmered for hours%';

-- ── what changed ───────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Bone broth, said plainly','brand','Ordering',
   'FORGE, HUNT and WILD read "Beef / Bison / Ostrich bone broth, pasture-raised" on the menu, the craft page, Primal and in the concierge''s answers, without "slow-simmered".',
   '2026-10-10', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (0 rows each):
--   select slug from public.products where what ilike '%simmer%' or array_to_string(ingredients, ' ') ilike '%simmer%';
--   select slug from public.primal_lessons where body ilike '%simmer%';
--   select product_slug from public.primal_lesson_products where rationale ilike '%simmer%';
--   select title from public.agent_knowledge where agent = 'concierge' and body ilike '%simmer%' and body not like '%MUST NOT call the broth "simmered"%';
--   select key from public.site_copy where value ilike '%simmer%';   -- an owner's override; none is seeded
select public.record_migration('0362_bone_broth_said_plainly');
