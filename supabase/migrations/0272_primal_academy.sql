-- 0272 - RETURN TO PRIMAL: the native customer nutrition academy, on the storefront spine.
-- Ryan: "ensure DB interoperability between the nutrition academy [and storefront], and between the
-- academy and the menu; make it engaging; meal-stacking - recommend something off the menu tied to
-- the education." And: education must be "extremely easy, engaging, systematic, referenceable
-- extremely quick."
--
-- WHY primal_* and not academy_*: the existing academy (0030/0031) is INTERNAL CREW TRAINING - crew
-- progress, certifications, food-safety e-sign, keyed by user_id, content in lib/academy.ts. This is
-- the CUSTOMER-facing nutrition funnel: a different audience, a different lifecycle. Folding it into
-- academy_* would both collide (academy_progress already exists with a different shape) and conflate
-- two domains. Separate domain, shared spine - the anti-piecemeal choice.
--
-- INTEROP, by design (three seams, zero new silos):
--   1) STOREFRONT: a paid tier is a shop_products row (kind='program_tier', program_tier='pro') and a
--      purchase grants program_access(customer_id,'pro') - both from 0271. A pro lesson is gated on
--      that SAME program_access ledger. Free 'rookie' is open. That is the funnel: rookie -> pro.
--   2) MENU: primal_lesson_products links a lesson to a real menu product by products.slug (exactly
--      like 0173 event_menu_items - slug text, not FK, because products are operator-deletable and the
--      teaching outlives the SKU). products.line + products.timing give the BEFORE/DURING/AFTER order,
--      so a lesson ends in a real, orderable "stack." primal_menu_for_lesson() returns that stack.
--   3) IDENTITY + PROGRESS: primal_progress is keyed by customers.id (the 0151 customer spine), and
--      the 0270 publish gate (published_at) governs what guests see. Born hidden, published by choice.
-- Apply after 0271.

-- 1) PILLARS - the five Return To Primal pillars (Nutrition, Movement, Stillness, Light, Fuel).
create table if not exists public.primal_pillars (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  slug         text not null,
  title        text not null,
  blurb        text,
  accent       text,                                            -- hex, matches the design tokens
  icon         text,                                            -- icon key for the UI
  sort         int not null default 0,
  published_at timestamptz,                                     -- 0270 publish gate - born hidden
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index if not exists primal_pillars_live on public.primal_pillars(sort) where (published_at is not null and archived_at is null);

-- 2) MODULES - sections within a pillar. Nutrition = AB-OS (Macronutrients, Micronutrients,
--    Bioavailability, Metabolic Flexibility, System Stability).
create table if not exists public.primal_modules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  pillar_id    uuid not null references public.primal_pillars(id) on delete cascade,
  slug         text not null,
  title        text not null,
  blurb        text,
  sort         int not null default 0,
  published_at timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (pillar_id, slug)
);
create index if not exists primal_modules_pillar on public.primal_modules(pillar_id, sort) where (published_at is not null and archived_at is null);

-- 3) LESSONS - the content. tier gates free(rookie) vs paid(pro). key_points is the quick-reference
--    ("referenceable extremely quick"); summary powers cards + search; source_ref carries the MindNode
--    filename so the importer (next round) can round-trip. body is markdown.
create table if not exists public.primal_lessons (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  module_id      uuid not null references public.primal_modules(id) on delete cascade,
  slug           text not null,
  title          text not null,
  subtitle       text,
  tier           text not null default 'rookie' check (tier in ('rookie','pro')),
  est_minutes    int,
  summary        text,                                          -- one-liner for cards + search
  key_points     jsonb not null default '[]'::jsonb,            -- quick-reference bullets
  body           text,                                          -- markdown lesson body
  hero_image_url text,
  source_ref     text,                                          -- e.g. '7Step Return to Primal Success.mindnode'
  sort           int not null default 0,
  published_at   timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (module_id, slug)
);
create index if not exists primal_lessons_module on public.primal_lessons(module_id, sort) where (published_at is not null and archived_at is null);
create index if not exists primal_lessons_tier on public.primal_lessons(tier) where (published_at is not null and archived_at is null);

-- 4) THE MEAL-STACK LINK - a lesson recommends real menu products (the "order this" payoff). slug is
--    text (not FK) on purpose: products are operator-deletable; the recommendation must not cascade.
create table if not exists public.primal_lesson_products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  lesson_id    uuid not null references public.primal_lessons(id) on delete cascade,
  product_slug text not null,                                   -- products.slug ('forge','rise', ...)
  rationale    text,                                            -- why this drink embodies the lesson
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  unique (lesson_id, product_slug)
);
create index if not exists primal_lesson_products_lesson on public.primal_lesson_products(lesson_id);
create index if not exists primal_lesson_products_slug on public.primal_lesson_products(product_slug);

-- 5) PROGRESS - engagement + funnel analytics. Keyed by the customer spine (not crew user_id).
create table if not exists public.primal_progress (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  customer_id  uuid not null references public.customers(id) on delete cascade,
  lesson_id    uuid not null references public.primal_lessons(id) on delete cascade,
  status       text not null default 'started' check (status in ('started','completed')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (customer_id, lesson_id)
);
create index if not exists primal_progress_customer on public.primal_progress(customer_id);
create index if not exists primal_progress_lesson on public.primal_progress(lesson_id);

-- THE MEAL-STACK RECOMMENDER - given a lesson, return its menu stack ordered BEFORE/DURING/AFTER, with
-- price + whether it is currently orderable. This is "recommend something off the menu" as one call.
create or replace function public.primal_menu_for_lesson(_lesson_id uuid)
returns table(product_slug text, name text, line text, timing text, price_cents int, accent text, rationale text, orderable boolean)
language sql stable security definer set search_path = public as $$
  select lp.product_slug, p.name, p.line, p.timing, p.price_cents, p.accent, lp.rationale,
         coalesce(p.active, false) as orderable
  from public.primal_lesson_products lp
  left join public.products p on p.slug = lp.product_slug
  where lp.lesson_id = _lesson_id
  order by case upper(coalesce(p.timing, ''))
             when 'BEFORE' then 0 when 'DURING' then 1 when 'AFTER' then 2 else 3 end, lp.sort;
$$;

-- ============================ RLS ============================
-- pillars + modules: guests see PUBLISHED only (0270 shape); staff see all; staff write.
alter table public.primal_pillars enable row level security;
drop policy if exists "primal pillars read" on public.primal_pillars;
create policy "primal pillars read" on public.primal_pillars for select
  using ((published_at is not null and archived_at is null) or (select public.is_staff()));
drop policy if exists "primal pillars write" on public.primal_pillars;
create policy "primal pillars write" on public.primal_pillars for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

alter table public.primal_modules enable row level security;
drop policy if exists "primal modules read" on public.primal_modules;
create policy "primal modules read" on public.primal_modules for select
  using ((published_at is not null and archived_at is null) or (select public.is_staff()));
drop policy if exists "primal modules write" on public.primal_modules;
create policy "primal modules write" on public.primal_modules for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- lessons: THE FUNNEL GATE. Published rookie lessons are open to everyone; published pro lessons need
-- a live program_access(customer,'pro') entitlement (0271); staff see everything.
alter table public.primal_lessons enable row level security;
drop policy if exists "primal lessons read" on public.primal_lessons;
create policy "primal lessons read" on public.primal_lessons for select using (
  (select public.is_staff())
  or (
    published_at is not null and archived_at is null and (
      tier = 'rookie'
      or exists (
        select 1 from public.program_access pa
        join public.customers c on c.id = pa.customer_id
        where c.user_id = (select auth.uid()) and pa.tier = primal_lessons.tier and pa.revoked_at is null
      )
    )
  )
);
drop policy if exists "primal lessons write" on public.primal_lessons;
create policy "primal lessons write" on public.primal_lessons for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- lesson_products: visible exactly when the parent lesson is (mirror the gate via EXISTS on lessons,
-- so a locked pro lesson does not leak its stack); staff write.
alter table public.primal_lesson_products enable row level security;
drop policy if exists "primal lesson products read" on public.primal_lesson_products;
create policy "primal lesson products read" on public.primal_lesson_products for select using (
  (select public.is_staff())
  or exists (
    select 1 from public.primal_lessons l
    where l.id = lesson_id and l.published_at is not null and l.archived_at is null and (
      l.tier = 'rookie'
      or exists (
        select 1 from public.program_access pa
        join public.customers c on c.id = pa.customer_id
        where c.user_id = (select auth.uid()) and pa.tier = l.tier and pa.revoked_at is null
      )
    )
  )
);
drop policy if exists "primal lesson products write" on public.primal_lesson_products;
create policy "primal lesson products write" on public.primal_lesson_products for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- progress: a customer owns their own rows (read + write); staff read all.
alter table public.primal_progress enable row level security;
drop policy if exists "primal progress owner" on public.primal_progress;
create policy "primal progress owner" on public.primal_progress for all
  using (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
drop policy if exists "primal progress staff read" on public.primal_progress;
create policy "primal progress staff read" on public.primal_progress for select
  using ((select public.is_staff()));

-- ============================ triggers (house patterns) ============================
-- tenant stamp on every tenant-scoped table
do $$
declare t text;
begin
  foreach t in array array['primal_pillars','primal_modules','primal_lessons','primal_lesson_products','primal_progress'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
  end loop;
end $$;
-- updated_at maintenance where the column exists
do $$
declare t text;
begin
  foreach t in array array['primal_pillars','primal_modules','primal_lessons','primal_progress'] loop
    execute format('drop trigger if exists touch_updated_at_tg on public.%I', t);
    execute format('create trigger touch_updated_at_tg before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ============================ seed: the structure + a live Rookie starter ============================
-- The five pillars (published, so /primal is not empty). Nutrition leads.
insert into public.primal_pillars (slug, title, blurb, accent, icon, sort, published_at) values
  ('nutrition','Nutrition','Why what you eat is the lever - the AB-OS operating system for real fuel.','#B82420','flame', 10, now()),
  ('movement','Movement','Move like your body was built to - strength, walking, and daily motion.','#8A5C3B','activity', 20, now()),
  ('stillness','Stillness','Rest, breath, and recovery - the half of the work most people skip.','#3B6B5E','moon', 30, now()),
  ('light','Light','Sunlight, circadian rhythm, and why timing your day matters.','#C9922F','sun', 40, now()),
  ('fuel','Fuel','Hydration and what to drink, before / during / after you move.','#2F6E86','droplet', 50, now())
on conflict (tenant_id, slug) do nothing;

-- Nutrition = AB-OS, five modules (published).
insert into public.primal_modules (pillar_id, slug, title, blurb, sort, published_at)
select p.id, m.slug, m.title, m.blurb, m.sort, now()
from public.primal_pillars p
join (values
  ('macronutrients','Macronutrients','Protein, fats, and carbohydrates - what each is really for.', 10),
  ('micronutrients','Micronutrients','Vitamins and minerals, and the foods that actually carry them.', 20),
  ('bioavailability','Bioavailability','It is not what you eat - it is what you absorb.', 30),
  ('metabolic-flexibility','Metabolic Flexibility','Burning both fuels well - the mark of a resilient system.', 40),
  ('system-stability','System Stability','Blood sugar, energy, and steadiness through the day.', 50)
) as m(slug, title, blurb, sort) on p.slug = 'nutrition'
on conflict (pillar_id, slug) do nothing;

-- One published Rookie lesson per starter theme, each ending in a real menu stack. Claim-safe:
-- composition + generally-recognized nutrition facts, never disease/cure/detox/hormone claims.
insert into public.primal_lessons (module_id, slug, title, subtitle, tier, est_minutes, summary, key_points, body, source_ref, sort, published_at)
select m.id, l.slug, l.title, l.subtitle, l.tier, l.est_minutes, l.summary, l.key_points::jsonb, l.body, l.source_ref, l.sort, now()
from public.primal_modules m
join (values
  ('macronutrients','power-carbs','Power Carbs','Not all carbs are equal.','rookie',3,
   'The difference between carbohydrates that fuel you and ones that just spike you.',
   '["Whole-food carbs come with fiber, water, and minerals","Added sugar and syrups give the spike without the package","Timing carbs around movement puts them to work"]',
   'Carbohydrates are a fuel, not an enemy. The question is the package they arrive in. A whole-food carb - fruit, tubers, real honey - carries fiber, water, and minerals alongside the sugar, so your body handles it steadily. A refined carb - added sugar, syrups - is the sugar with the package stripped off. GT3 keeps the package: our cold-extracted coffees are built on real ingredients with no added sugar, so the lift is clean. Educational only, not medical advice.',
   '7Step Return to Primal Success.mindnode', 10),
  ('micronutrients','ruminant-red','Ruminant Red Meat','The most nutrient-dense food there is.','rookie',3,
   'Why grass-fed ruminant meat and its broth are a micronutrient anchor.',
   '["Complete protein with all essential amino acids","Dense in heme iron, zinc, and B12","Bone broth adds collagen and minerals for the rebuild"]',
   'Ruminant animals - beef, bison - concentrate minerals from the grass they eat into some of the most nutrient-dense food available: a complete protein carrying heme iron, zinc, and B12 in forms the body reads easily. Slow-simmered bone broth extends that: collagen and minerals in an easy-to-take cup, which is why it sits in the AFTER slot of the stack, for the rebuild. Educational only, not medical advice.',
   'Ruminant RED Meat.mindnode', 20),
  ('system-stability','steady-energy','Steady Energy','Off the spike-and-crash.','rookie',3,
   'How whole-food fuel keeps energy level instead of swinging.',
   '["Spikes are followed by crashes","Protein, fat, and fiber slow the curve","Steady in beats high-then-low every time"]',
   'The spike-and-crash is a swing: a fast sugar hit sends energy up, then the drop sends it below where you started. Anchoring a meal or a drink with protein, fat, or fiber flattens that curve, so you get steady energy instead of a peak and a slump. This is the whole idea behind fueling before you move rather than sugaring through the day. Educational only, not medical advice.',
   'Power Carbs.mindnode', 30)
) as l(mod_slug, slug, title, subtitle, tier, est_minutes, summary, key_points, body, source_ref, sort)
  on m.slug = l.mod_slug
on conflict (module_id, slug) do nothing;

-- The MEAL-STACK links - each starter lesson points at a real, orderable stack.
insert into public.primal_lesson_products (lesson_id, product_slug, rationale, sort)
select l.id, x.product_slug, x.rationale, x.sort
from public.primal_lessons l
join (values
  ('power-carbs','rise','Clean cold-extracted coffee, no added sugar - a steady lift before you move.',10),
  ('power-carbs','flow','Cacao-infused for a little longer focus - same no-sugar build.',20),
  ('power-carbs','dusk','Cinnamon and cardamom, warm and spiced - clean carbs, no crash.',30),
  ('ruminant-red','forge','Slow-simmered beef bone broth - collagen and minerals for the rebuild.',10),
  ('ruminant-red','hunt','Bison broth, leaner with a little more iron and zinc.',20),
  ('steady-energy','aide','Real hydration with no sugar - steady, not a spike.',10)
) as x(lesson_slug, product_slug, rationale, sort) on l.slug = x.lesson_slug
on conflict (lesson_id, product_slug) do nothing;

-- ============================ the record (no-drift gate) ============================
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Return To Primal: the native nutrition academy','feature','Academy',
   'The Return To Primal nutrition education funnel is now native in the app, not a side site: five pillars (Nutrition, Movement, Stillness, Light, Fuel), the AB-OS nutrition modules, and lessons that are quick to reference and free to start (Rookie), with paid depth (Pro) sold and unlocked through the same storefront and entitlement spine as the shop. Every lesson can end in a real menu stack - the drink that embodies what you just learned, ordered before, during, or after - so learning turns into a cup at the truck. Guests see only what is published; a customer keeps their own progress.',
   '2026-08-08', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- Verify (prod, after apply):
--   select count(*) from pg_policies where tablename like 'primal_%';                        -- 10
--   select (select count(*) from primal_pillars), (select count(*) from primal_modules),
--          (select count(*) from primal_lessons), (select count(*) from primal_lesson_products);
--   select * from primal_menu_for_lesson((select id from primal_lessons where slug='power-carbs'));  -- rise/flow/dusk, BEFORE
