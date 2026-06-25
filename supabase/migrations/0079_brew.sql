-- 0079 — GT3 Brew: recipes + batch schedule.
-- Brewing is part of ops. A RECIPE is defined per a reference water volume (base_water_gal) with a
-- target spec ("OG"/Signal Score) and an ingredient list whose quantities scale linearly with water.
-- A BATCH is one scheduled production run at a chosen size (batch_gal) — back-scheduled from when it's
-- needed (cold extraction + hold lead time), optionally tied to the event it's brewed for. Same high
-- standard: every batch carries the spec and gets logged.

create table if not exists public.brew_recipes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name            text not null,
  product_slug    text,                          -- optional link to products.slug
  style           text,                          -- 'cold-brew coffee', 'nitro', 'broth', 'blend'…
  ratio           text,                          -- human spec, e.g. '1:13 coffee:water by weight'
  target_spec     text,                          -- the "OG"/quality target, e.g. 'Signal Score 8+'
  base_water_gal  numeric not null default 1,    -- the reference batch the ingredient list is defined for
  -- ingredients: [{ name, qty, unit, scales }]; qty is the amount for base_water_gal. scales=false
  -- means it's a fixed/per-step item (e.g. 'filter') that doesn't multiply with volume.
  ingredients     jsonb not null default '[]',
  method          text[] not null default '{}',  -- ordered brew steps
  extraction_hours numeric not null default 0,   -- e.g. 18 (cold extraction time)
  hold_hours      numeric not null default 0,    -- safe hold window after it's ready
  yield_factor    numeric not null default 0.92, -- servable fraction of water volume after loss
  notes           text,
  archived_at     timestamptz,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.brew_batches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  recipe_id     uuid references public.brew_recipes(id) on delete set null,
  recipe_name   text,                          -- denormalized so a batch survives recipe deletion
  batch_gal     numeric not null default 1,    -- water volume for THIS run
  brew_date     date,                          -- when brewing starts
  ready_at      timestamptz,                   -- when it's ready to serve (brew + extraction)
  event_id      uuid references public.events(id) on delete set null, -- brewed for this event
  target_spec   text,                          -- the spec to hit this run
  scaled        jsonb,                         -- the scaled ingredient list the agent computed
  status        text not null default 'planned' check (status in ('planned','brewing','ready','kegged','served','dumped')),
  og            text,                          -- measured/target original gravity / signal score
  signal_score  int,                           -- logged quality (0-10) — "same high standard"
  notes         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists brew_batches_ready_idx on public.brew_batches(ready_at);
create index if not exists brew_batches_event_idx on public.brew_batches(event_id) where event_id is not null;

alter table public.brew_recipes enable row level security;
alter table public.brew_batches enable row level security;
-- Recipes: staff read; leadership writes (recipes are the standard). Batches: any staff can plan/log.
create policy brew_recipes_read   on public.brew_recipes for select using (public.is_staff());
create policy brew_recipes_write  on public.brew_recipes for all    using (public.is_admin()) with check (public.is_admin());
create policy brew_batches_read   on public.brew_batches for select using (public.is_staff());
create policy brew_batches_insert on public.brew_batches for insert with check (public.is_staff());
create policy brew_batches_update on public.brew_batches for update using (public.is_staff()) with check (public.is_staff());
create policy brew_batches_delete on public.brew_batches for delete using (public.is_staff());

-- Seed the THREE OG production standards (Cowork memory): Rise / Flow / Dusk. Defined per the
-- 2-gallon base (256 oz, 25 × 10-oz pours). 1:13 coffee:water — 560 g coffee per 2 gal. Coarse grind,
-- cold extraction 12–18 hrs (17 preferred), filter until clean, Mountain Valley Spring Water ONLY,
-- always calculate production in 10-oz servings. yield_factor 1.0 → the spec's 25 servings per 2 gal.
-- Quantities scale linearly with water volume, so any batch (e.g. 4 gal → ×2) stays exactly on spec.
-- Future R&D (Enhanced Rise, seasonal, functional) should branch from these stable references.

insert into public.brew_recipes (name, product_slug, style, ratio, target_spec, base_water_gal, ingredients, method, extraction_hours, hold_hours, yield_factor, notes, sort)
select 'GT3 Rise (OG)', 'rise', 'cold-brew coffee', '1:13 — 560 g coffee / 2 gal', 'OG · 1:13 · Signal Score 8+', 2,
       '[{"name":"Mountain Valley Spring Water","qty":2,"unit":"gal","scales":true},
         {"name":"Coarse-ground organic single-origin coffee","qty":560,"unit":"g","scales":true},
         {"name":"Organic coconut water (add after filtration)","qty":32,"unit":"oz","scales":true}]'::jsonb,
       array['Add the coarse-ground coffee to the brew system','Pour in the spring water; saturate all grounds','Cold-extract 12–20 hrs (20 hrs preferred)','Filter thoroughly until it runs clean','Stir in the organic coconut water after filtration','Bottle or keg immediately and refrigerate; log Signal Score (8+)'],
       20, 72, 1.0,
       'Activation. Input: organic coffee + organic coconut water. Signal: bright, naturally hydrating, smooth energy. Clean morning activation with naturally occurring electrolytes. Mountain Valley Spring Water only.', 0
where not exists (select 1 from public.brew_recipes where name = 'GT3 Rise (OG)');

insert into public.brew_recipes (name, product_slug, style, ratio, target_spec, base_water_gal, ingredients, method, extraction_hours, hold_hours, yield_factor, notes, sort)
select 'GT3 Flow (OG)', 'flow', 'cold-brew coffee', '1:13 — 560 g coffee / 2 gal', 'OG · 1:13 · Signal Score 8+', 2,
       '[{"name":"Mountain Valley Spring Water","qty":2,"unit":"gal","scales":true},
         {"name":"Coarse-ground organic single-origin coffee","qty":560,"unit":"g","scales":true},
         {"name":"Organic cacao nibs (mix with grounds)","qty":160,"unit":"g","scales":true}]'::jsonb,
       array['Add the coarse-ground coffee','Mix the cacao nibs evenly with the grounds','Pour in the spring water; ensure complete saturation','Cold-extract 12–20 hrs (20 preferred)','Filter thoroughly until it runs clean','Bottle or keg immediately and refrigerate; log Signal Score (8+)'],
       20, 72, 1.0,
       'Sustained performance. Input: organic coffee + organic cacao nibs. Signal: smooth chocolate notes with clean, sustained energy. Balanced performance and focus. Mountain Valley Spring Water only.', 1
where not exists (select 1 from public.brew_recipes where name = 'GT3 Flow (OG)');

insert into public.brew_recipes (name, product_slug, style, ratio, target_spec, base_water_gal, ingredients, method, extraction_hours, hold_hours, yield_factor, notes, sort)
select 'GT3 Dusk (OG)', 'dusk', 'cold-brew coffee', '1:13 — 560 g coffee / 2 gal', 'OG · 1:13 · Signal Score 8+', 2,
       '[{"name":"Mountain Valley Spring Water","qty":2,"unit":"gal","scales":true},
         {"name":"Coarse-ground organic single-origin coffee","qty":560,"unit":"g","scales":true},
         {"name":"Organic Ceylon cinnamon sticks","qty":8,"unit":"sticks","scales":true},
         {"name":"Organic cardamom pods (lightly cracked)","qty":48,"unit":"pods","scales":true}]'::jsonb,
       array['Add the coarse-ground coffee','Add the cinnamon sticks and lightly cracked cardamom pods','Pour in the spring water and fully saturate the coffee bed','Cold-extract 12–20 hrs (20 preferred)','Filter thoroughly until it runs clean','Bottle or keg immediately and refrigerate; log Signal Score (8+)'],
       20, 72, 1.0,
       'Smooth evening coffee with warming botanicals. Input: organic coffee + Ceylon cinnamon + cardamom. Signal: warming spice profile with a smooth finish. Calm, steady focus for later in the day. Mountain Valley Spring Water only.', 2
where not exists (select 1 from public.brew_recipes where name = 'GT3 Dusk (OG)');
