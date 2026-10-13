-- ── 0393 — THE CATALOG IS THE MENU ─────────────────────────────────────────────────────────────────────────────────
-- 2026-10-13. R2 of the customer frontend audit, "One catalog" (approved 2026-10-12, "yes to all improvements";
-- decision (a): the Catalog becomes the menu and the code list is retired). Ryan, 2026-10-13: NATURE'S AIDE is organic
-- coconut water, organic lime juice, organic maple syrup and sea salt — no mineral water; and the caffeine tag and the
-- "contains" line are filled from each drink's own ingredients.
--
-- WHY. The menu customers order from was ten drinks typed into lib/menu.ts. The Catalog set two things about them,
-- price and sold out. A drink added in the Catalog never reached the menu and was refused at Pay as "Unknown item"; the
-- words on the menu were the code's, or the owner's edits stored as page copy, so the Catalog's own descriptions said
-- something else (NATURE'S AIDE's line said lime juice, its ingredient list — code nobody could edit — mineral water).
--
-- WHAT.
--   · products.cup_orderable — "sold by the cup": what the cup menu lists. On for the ten drinks on the menu today,
--     off for every other product (Salted Latte is a pack add-on; it never was a cup), on by default for a new one.
--   · products.caffeine (null = not said), products.contains (null = not said), products.tag ("Start here", "Nitro"),
--     products.when_text ("Morning, before the first task.") — the four things the menu showed that had no column.
--   · The ten drinks' rows say what the menu says today. A field is filled only where the Catalog still holds what a
--     seed wrote (0062, 0127, 0362) or nothing: a field the owner has written in the Catalog keeps his words. What the
--     menu says is the owner's edit on the menu where he made one (site_copy menu.<drink>.name / lines / why / tag —
--     TIDE's and NATURE'S AIDE's lines today), the code's words otherwise.
--     TIDE's ingredient list was seeded "Raw honey", "Organic Thai coconut meat"; the menu has said "Organic local
--     honey", "Young organic Thai coconut meat" since July — the menu's words. The broths' line was seeded "Recovery";
--     customers read them under "Fuel". NATURE'S AIDE and TIDE shared sort 20; AIDE is 21, so the menu keeps its order.
--   · A section's subtitle ("Before the work") is copy keyed by the section's name now (menu.line.<name>.sub), not by
--     its position; an owner's edit to the old positional key (menu.sec.<n>.sub) moves across. The drink sheet's pillar
--     line is the section's name and subtitle (sheet.pillar_* were never edited in production, read 2026-10-13).
--   · stop_menu(stop): the drinks a stop pours, for the menu and Pay. event_menu_items is the crew's (0173, staff
--     only); this answers one stop's list and nothing else. null = no menu set for that stop, which limits nothing.
--
-- ORDER. Either way round. Pasted first, the running app ignores the new columns. Deployed first, the menu reads the
-- old columns and fills the rest from the code list (arrives-with: 0393), and a stop's menu limits nothing yet.
-- existing rows: products (the ten drinks' unedited fields, once — a second run fills nothing; cup_orderable off for every
--                other product, today's state), site_copy (a section subtitle an owner edited or a renamed section's, copied
--                to its new key — none in production 2026-10-13; the Craft page's mineral-water line, where it is still the
--                default's words).
-- changelog: below.

alter table public.products add column if not exists cup_orderable boolean;
alter table public.products add column if not exists caffeine boolean;
alter table public.products add column if not exists contains text[];
alter table public.products add column if not exists tag text;
alter table public.products add column if not exists when_text text;
comment on column public.products.cup_orderable is 'Sold by the cup: on the menu customers order from (0393). Off = packs, delivery or events only.';
comment on column public.products.caffeine is 'Caffeine: true, false, or null when not said (0393). The menu never guesses.';
comment on column public.products.contains is 'What someone avoiding it should know ("Goat milk", "Coconut"); null when not said (0393).';
comment on column public.products.tag is 'A short editorial anchor on the menu row ("Start here", "Nitro") (0393).';
comment on column public.products.when_text is 'When to drink it, one line ("Morning, before the first task.") (0393).';

-- ── what the menu says today: the code list, then an owner's edits on the menu over it ─────────────────────────────
create temp table if not exists _r2_menu (
  slug text primary key, name text, what text, why text, ingredients text[], excludes text[], timing text, tag text,
  when_text text, line text, accent text, caffeine boolean, contains text[]
);
truncate _r2_menu;
insert into _r2_menu values
  ('rise', 'RISE', E'Cold-extracted coffee in mineral water\nFinished with Organic Coconut Water', 'A clean, even lift to start the morning.',
   '{"Single-origin cold extraction","Mineral water base","Organic coconut water"}', '{"Sugar","Dairy","Syrups","Preservatives"}',
   'BEFORE', 'Start here', 'Morning, before the first task.', 'Activation', '#C49A5E', true, '{"Coconut"}'),
  ('flow', 'FLOW', E'Cold-extracted coffee in mineral water\nInfused with Organic Cacao Nibs', 'Cacao to keep the focus going a little longer.',
   '{"Single-origin cold extraction","Mineral water base","Organic cacao nibs"}', '{"Sugar","Dairy","Syrups","Preservatives"}',
   'BEFORE', null, 'Before deep, heads-down work.', 'Activation', '#6B4429', true, '{}'),
  ('dusk', 'DUSK', E'Cold-extracted coffee in mineral water\nCeylon Cinnamon · Green Cardamom', 'Cinnamon and cardamom for a warmer, spiced cup.',
   '{"Single-origin cold extraction","Mineral water base","Ceylon cinnamon","Green cardamom"}', '{"Sugar","Dairy","Syrups","Preservatives"}',
   'BEFORE', null, 'Afternoon, when you want a warmer cup with the same lift.', 'Activation', '#9C6B3F', true, '{}'),
  ('kingme', 'KING ME', E'FLOW brew served on nitrogen\nVelvety, naturally creamy, subtly sweet', 'A sensory phenomenon — texture and microbubbles, nothing added.',
   '{"FLOW cold-extraction","Nitrogen infusion"}', '{"Sugar","Dairy","Syrups","Preservatives"}',
   'BEFORE', 'Nitro', 'The same clean lift, with a creamy nitro texture.', 'Activation', '#6B4429', true, '{}'),
  ('maple', 'SALTED MAPLE LATTE', E'DUSK brew with Organic A2 grass-fed goat milk\nOrganic maple · Sea salt', 'Rich, naturally sweet and smooth.',
   '{"DUSK cold-extraction (Ceylon cinnamon · green cardamom)","Organic A2 grass-fed goat milk","Organic maple syrup","Sea salt"}', '{"Refined sugar","Seed oils","Preservatives"}',
   'BEFORE', null, 'An afternoon treat that still eats clean.', 'Activation', '#B8902F', true, '{"Goat milk"}'),
  ('tide', 'TIDE', E'Young coconut water + young organic Thai coconut meat\nFinished with organic local honey', 'Real hydration that goes down easy.',
   '{"Organic young coconut water","Young organic Thai coconut meat","Organic local honey","Blended to order"}', '{"Marine collagen","Powders","Concentrate"}',
   'DURING', null, 'During work or training.', 'Hydration', '#2F7D74', false, '{"Coconut","Honey"}'),
  ('aide', 'NATURE''S AIDE', E'Organic coconut water + organic lime juice\nOrganic maple · Sea salt', 'Light, balanced hydration for the middle of the work.',
   '{"Organic coconut water","Organic lime juice","Organic maple syrup","Sea salt"}', '{"Powders","Concentrate","Dyes"}',
   'DURING', null, 'During work or training.', 'Hydration', '#A97C3F', false, '{"Coconut"}'),
  ('forge', 'FORGE', E'Beef Bone Broth\nPasture-Raised', 'Deep and rich, full of minerals for the rebuild.',
   '{"Beef bone broth","Pasture-raised"}', '{"Bouillon","Additives","Powders","Filler"}',
   'AFTER', null, 'After training, within the hour.', 'Fuel', '#B8423C', false, '{}'),
  ('hunt', 'HUNT', E'Bison Bone Broth\nPasture-Raised', 'Leaner than beef, with a little more iron and zinc.',
   '{"Bison bone broth","Pasture-raised"}', '{"Bouillon","Additives","Powders","Filler"}',
   'AFTER', null, 'After training, within the hour.', 'Fuel', '#8A5C7D', false, '{}'),
  ('wild', 'WILD', E'Ostrich Bone Broth\nPasture-Raised', 'A lighter, leaner broth for an easy rebuild.',
   '{"Ostrich bone broth","Pasture-raised"}', '{"Bouillon","Additives","Powders","Filler"}',
   'AFTER', null, 'After a lighter session, or in the evening.', 'Fuel', '#A89150', false, '{}');

-- An owner's edit on the menu is what customers read: it wins over the code's words. A section renamed on the menu
-- (menu.sec.<n>.name) renames the line its drinks sit under.
update _r2_menu m set line = btrim(c.value) from public.site_copy c
 where c.key = 'menu.sec.' || (case m.line when 'Activation' then '0' when 'Hydration' then '1' when 'Fuel' then '2' end) || '.name'
   and btrim(c.value) <> '';
update _r2_menu m set name = btrim(c.value) from public.site_copy c where c.key = 'menu.' || m.slug || '.name' and btrim(c.value) <> '';
update _r2_menu m set what = btrim(c.value) from public.site_copy c where c.key = 'menu.' || m.slug || '.lines' and btrim(c.value) <> '';
update _r2_menu m set why = btrim(c.value) from public.site_copy c where c.key = 'menu.' || m.slug || '.why' and btrim(c.value) <> '';
update _r2_menu m set tag = btrim(c.value) from public.site_copy c where c.key = 'menu.' || m.slug || '.tag' and btrim(c.value) <> '';
-- Once. A second run (the ledger has this migration) fills nothing: by then a field the owner has emptied in the Catalog
-- is his choice, not a gap.
delete from _r2_menu where exists (select 1 from public.schema_migrations where version = '0393_the_catalog_is_the_menu');

-- ── what a seed wrote: a Catalog field that still holds one of these was never edited ──────────────────────────────
create temp table if not exists _r2_seed (slug text not null, field text not null, txt text, arr text[]);
truncate _r2_seed;
insert into _r2_seed (slug, field, txt)
select slug, 'name', name from (values ('rise','RISE'),('flow','FLOW'),('dusk','DUSK'),('kingme','KING ME'),('maple','SALTED MAPLE LATTE'),
  ('tide','TIDE'),('aide','NATURE''S AIDE'),('forge','FORGE'),('hunt','HUNT'),('wild','WILD')) v(slug, name)
union all select slug, 'what', what from (values
  ('rise','Cold-extracted coffee in mineral water, finished with organic coconut water.'),
  ('flow','Cold-extracted coffee in mineral water, infused with organic cacao nibs.'),
  ('dusk','Cold-extracted coffee in mineral water with Ceylon cinnamon & green cardamom.'),
  ('tide','Young coconut water + Thai coconut meat, finished with a touch of raw honey.'),
  ('forge','Slow-simmered, pasture-raised beef bone broth.'), ('forge','Pasture-raised beef bone broth.'),
  ('hunt','Slow-simmered, pasture-raised bison bone broth.'), ('hunt','Pasture-raised bison bone broth.'),
  ('wild','Slow-simmered, pasture-raised ostrich bone broth.'), ('wild','Pasture-raised ostrich bone broth.')) v(slug, what)
union all select slug, 'why', why from (values
  ('rise','A clean, even lift to start the morning.'), ('flow','Cacao to keep the focus going a little longer.'),
  ('dusk','Cinnamon and cardamom for a warmer, spiced cup.'), ('tide','Real hydration that goes down easy.'),
  ('forge','Deep and rich, full of minerals for the rebuild.'), ('hunt','Leaner than beef, with a little more iron and zinc.'),
  ('wild','A lighter, leaner broth for an easy rebuild.')) v(slug, why)
union all select slug, 'line', line from (values ('rise','Activation'),('flow','Activation'),('dusk','Activation'),('kingme','Activation'),
  ('maple','Activation'),('tide','Hydration'),('aide','Hydration'),('forge','Recovery'),('hunt','Recovery'),('wild','Recovery')) v(slug, line);
insert into _r2_seed (slug, field, arr) values
  ('rise', 'ingredients', '{"Single-origin cold extraction","Mineral water base","Organic coconut water"}'),
  ('flow', 'ingredients', '{"Single-origin cold extraction","Mineral water base","Organic cacao nibs"}'),
  ('dusk', 'ingredients', '{"Single-origin cold extraction","Mineral water base","Ceylon cinnamon","Green cardamom"}'),
  ('tide', 'ingredients', '{"Organic young coconut water","Organic Thai coconut meat","Raw honey","Blended to order"}'),
  ('aide', 'ingredients', '{"Coconut water","Mineral water","Organic maple syrup","Sea salt"}'),
  ('forge', 'ingredients', '{"Slow-simmered beef bone broth","Pasture-raised"}'), ('forge', 'ingredients', '{"Beef bone broth","Pasture-raised"}'),
  ('hunt', 'ingredients', '{"Slow-simmered bison bone broth","Pasture-raised"}'), ('hunt', 'ingredients', '{"Bison bone broth","Pasture-raised"}'),
  ('wild', 'ingredients', '{"Slow-simmered ostrich bone broth","Pasture-raised"}'), ('wild', 'ingredients', '{"Ostrich bone broth","Pasture-raised"}'),
  ('rise', 'excludes', '{"Sugar","Dairy","Syrups","Preservatives"}'), ('flow', 'excludes', '{"Sugar","Dairy","Syrups","Preservatives"}'),
  ('dusk', 'excludes', '{"Sugar","Dairy","Syrups","Preservatives"}'), ('tide', 'excludes', '{"Marine collagen","Powders","Concentrate"}'),
  ('forge', 'excludes', '{"Bouillon","Additives","Powders","Filler"}'), ('hunt', 'excludes', '{"Bouillon","Additives","Powders","Filler"}'),
  ('wild', 'excludes', '{"Bouillon","Additives","Powders","Filler"}');

-- ── the ten drinks' rows say what the menu says ──────────────────────────────────────────────────────────────────────
-- One update per drink (one line each in the change log, one realtime event each), field by field: a field still as a
-- seed wrote it, or empty, takes the menu's words; a field the owner wrote keeps his. The four new fields are empty.
-- TIDE and NATURE'S AIDE were both seeded at sort 20; the menu lists TIDE first.
update public.products p set
  name = case when btrim(coalesce(p.name, '')) = '' or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'name' and s.txt = p.name) then m.name else p.name end,
  what = case when btrim(coalesce(p.what, '')) = '' or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'what' and s.txt = p.what) then m.what else p.what end,
  why = case when btrim(coalesce(p.why, '')) = '' or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'why' and s.txt = p.why) then m.why else p.why end,
  ingredients = case when coalesce(cardinality(p.ingredients), 0) = 0 or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'ingredients' and s.arr = p.ingredients) then m.ingredients else p.ingredients end,
  excludes = case when coalesce(cardinality(p.excludes), 0) = 0 or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'excludes' and s.arr = p.excludes) then m.excludes else p.excludes end,
  line = case when btrim(coalesce(p.line, '')) = '' or exists (select 1 from _r2_seed s where s.slug = p.slug and s.field = 'line' and s.txt = p.line) then m.line else p.line end,
  timing = case when btrim(coalesce(p.timing, '')) = '' then m.timing else p.timing end,
  accent = case when btrim(coalesce(p.accent, '')) = '' then m.accent else p.accent end,
  tag = coalesce(p.tag, m.tag),
  when_text = coalesce(p.when_text, m.when_text),
  caffeine = coalesce(p.caffeine, m.caffeine),
  contains = coalesce(p.contains, m.contains),
  sort = case when p.slug = 'aide' and p.sort = 20 and exists (select 1 from public.products t where t.slug = 'tide' and t.sort = 20) then 21 else p.sort end
from _r2_menu m
where p.slug = m.slug;

-- Sold by the cup: today's menu exactly. Set once — a second run finds no row without an answer.
update public.products p set cup_orderable = exists (select 1 from _r2_menu m where m.slug = p.slug) where p.cup_orderable is null;
alter table public.products alter column cup_orderable set default true;
alter table public.products alter column cup_orderable set not null;

-- A section's subtitle follows the section's name (the name customers read): an owner's edited subtitle moves to it, and a
-- section the owner renamed keeps its subtitle — his, or the one it had (the code's defaults are only for the three names).
insert into public.site_copy (key, value, updated_at)
select 'menu.line.' || coalesce(nullif(btrim(n.value), ''), l.line) || '.sub', coalesce(nullif(btrim(c.value), ''), l.sub), now()
  from (values ('0', 'Activation', 'Before the work'), ('1', 'Hydration', 'During the work'), ('2', 'Fuel', 'After the work')) l(i, line, sub)
  left join public.site_copy c on c.key = 'menu.sec.' || l.i || '.sub'
  left join public.site_copy n on n.key = 'menu.sec.' || l.i || '.name'
 where nullif(btrim(c.value), '') is not null or (nullif(btrim(n.value), '') is not null and btrim(n.value) <> l.line)
on conflict (key) do nothing;

-- The Craft page's hydration list named a mineral-water base; neither hydration drink has one now (the owner, 2026-10-13).
-- Only where the page still says it in the default's words; the code's default changes with this release.
update public.site_copy
   set value = replace(value, 'Mineral water base — We build on mineral water, not stripped water, so there''s substance behind every pour.',
                              'Organic lime juice · NATURE''S AIDE — A squeeze of organic lime with organic maple and a pinch of sea salt: light, bright hydration, never from a powder.'),
       updated_at = now()
 where key = 'craft.hyd_items' and value like '%Mineral water base — We build on mineral water, not stripped water%';

drop table if exists _r2_menu;
drop table if exists _r2_seed;

-- ── a stop's menu, for the menu and Pay ──────────────────────────────────────────────────────────────────────────────
create or replace function public.stop_menu(p_stop uuid) returns text[]
  language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 then null else array_agg(product_slug order by product_slug) end
    from public.event_menu_items where stop_id = p_stop
$$;
revoke all on function public.stop_menu(uuid) from public;
grant execute on function public.stop_menu(uuid) to anon, authenticated, service_role;
comment on function public.stop_menu(uuid) is
  'The drinks a stop pours (0393): its event_menu_items slugs, or null when no menu is set (which limits nothing). Public: the menu shows it.';

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The Catalog is the menu', 'feature', 'Ordering',
   'The menu, the drink sheet, the cart, the Pass, the truck''s board and Ask us read their drinks from the Catalog. A drink added there is on the menu the next time it opens; one taken off can''t be ordered; and a stop given its own menu sells what that menu lists. Each drink says whether it has caffeine and what it contains. Your edits on the menu kept their words.',
   '2026-10-13', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0393_the_catalog_is_the_menu');

-- verify:
--   select count(*) from public.products where cup_orderable;                                            -- 10
--   select slug from public.products where not cup_orderable order by slug;                             -- salted-latte (+ any item-…)
--   select count(*) from public.products where slug in ('rise','flow','dusk','kingme','maple') and caffeine;   -- 5
--   select array_to_string(ingredients, ', ') from public.products where slug = 'aide';  -- Organic coconut water, Organic lime juice, Organic maple syrup, Sea salt
--   select count(*) from pg_proc where proname = 'stop_menu';                                            -- 1
