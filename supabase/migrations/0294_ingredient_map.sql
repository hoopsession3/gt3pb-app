-- 0294 — The bridge between a recipe and a shelf.
--
-- WHAT 0293 EXPOSED. With the chain in place, the consumption path turned out to be inert. The brew
-- route writes a ledger row per scaled ingredient keyed by the RECIPE's own words — 'Coarse-ground
-- organic single-origin coffee' — while the shelf is a purchase-catalog name, 'Yupik Organic Raw
-- Cacao Nibs 2.2 lb'. Not one of the ten ingredient lines across the three live recipes matches an
-- inventory item. Every draw-down ever written landed on a shelf that does not exist: three rows,
-- -420 coffee, -1.5 water, -24 coconut water, debiting nothing. That is why five batches were served
-- while the shelf never moved.
--
-- Two vocabularies, and neither is wrong. A recipe says 160 g of cacao nibs because that is how you
-- brew. A shelf says one Yupik 2.2 lb bag because that is how you buy. The missing thing is the
-- sentence between them: one gram of the recipe's nibs is 1/997.9 of a bag. That sentence is data,
-- it is per-item, and nobody can derive it from the two names — so it gets a table.
--
-- WHY THE CONVERSION IS NOT NULLABLE AND WHY basis IS REQUIRED. A map row that links an ingredient to
-- a shelf but cannot say how much comes off is worse than no row: it looks resolved and draws the
-- wrong number. Every row must carry a factor and must say in writing where the factor came from.
-- Of the six distinct ingredients in the live recipes, exactly ONE can be derived with certainty from
-- what the app already knows (2.2 lb is stated in the item's own name). The other five need a scale,
-- a count, or a shelf that does not exist yet. Those are seeded as nothing and listed as gaps —
-- inventing 'about 200 pods in 4 oz' would put a fabricated number into the cost of every batch.
--
-- WHAT CHANGES ABOUT THE GUARD. 0293 let a batch through if any negative row carried its id. That is
-- satisfiable by drawing one of six ingredients, which would call a batch accounted while five of its
-- inputs walked off the shelf unrecorded. The guard now asks the batch itself whether consumption was
-- logged, and log_batch_consumption() records what it COULD NOT draw alongside what it did. A batch
-- with gaps is still servable — the crew cannot be stuck at an event — but it carries the list of what
-- was not accounted for, permanently, and v_unaccounted_batches names it.

-- ── the sentence between a recipe and a shelf ──────────────────────────────────────────────
create table if not exists public.recipe_ingredient_map (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  ingredient    text not null,                       -- the recipe's own words, matched case-insensitively
  market        text references public.markets(slug),-- null = every market
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  recipe_unit   text,                                -- 'g', 'gal', 'oz', 'pods' — what the recipe counts in
  shelf_unit    text,                                -- 'each', 'lb' — what the shelf counts in
  shelf_qty_per_recipe_unit numeric not null check (shelf_qty_per_recipe_unit > 0),
  basis         text not null,                       -- where the number came from. Required: no silent magic.
  confirmed_by  uuid references auth.users(id) on delete set null,
  confirmed_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One rule per ingredient per market; a market-specific row beats the global one.
create unique index if not exists recipe_ingredient_map_key
  on public.recipe_ingredient_map (lower(btrim(ingredient)), coalesce(market, '*'));

alter table public.recipe_ingredient_map enable row level security;
drop policy if exists "map staff" on public.recipe_ingredient_map;
create policy "map staff" on public.recipe_ingredient_map for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.recipe_ingredient_map;
create policy "tenant isolation" on public.recipe_ingredient_map as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update on public.recipe_ingredient_map to authenticated;

drop trigger if exists stamp_tenant_tg on public.recipe_ingredient_map;
create trigger stamp_tenant_tg before insert on public.recipe_ingredient_map
  for each row execute function public.stamp_tenant();
drop trigger if exists touch_updated_at_tg on public.recipe_ingredient_map;
create trigger touch_updated_at_tg before update on public.recipe_ingredient_map
  for each row execute function public.touch_updated_at();
drop trigger if exists audit_recipe_ingredient_map on public.recipe_ingredient_map;
create trigger audit_recipe_ingredient_map after insert or update or delete
  on public.recipe_ingredient_map for each row execute function public.audit_row();

comment on table public.recipe_ingredient_map is
  'How much of a shelf one unit of a recipe ingredient takes. Without a row here a recipe line cannot come off any shelf, however carefully the batch is logged.';
comment on column public.recipe_ingredient_map.basis is
  'Where the factor came from, in words. A conversion nobody can retrace is a number nobody should trust.';

-- ── a batch belongs to a city, and remembers whether it was accounted ──────────────────────
alter table public.brew_batches add column if not exists market text;
alter table public.brew_batches add column if not exists consumption_logged_at timestamptz;
alter table public.brew_batches add column if not exists consumption_gaps jsonb not null default '[]'::jsonb;

-- Every batch on the books was brewed between June and July 2026, when Greenville was the only
-- market operating — Atlanta holds an opens_on of 2026-12-01 and has never brewed. So the backfill
-- is 'greenville' by fact, not by default. Deliberately NOT derived from the batch's event: that
-- would look more careful while resolving to the same answer through a nullable join.
update public.brew_batches set market = 'greenville' where market is null;
alter table public.brew_batches alter column market set default 'greenville';
alter table public.brew_batches alter column market set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brew_batches_market_fk') then
    alter table public.brew_batches add constraint brew_batches_market_fk
      foreign key (market) references public.markets(slug);
  end if;
end $$;

comment on column public.brew_batches.consumption_gaps is
  'Ingredients this batch used that could not be drawn off a shelf, and why. Kept rather than dropped: a batch that was only partly accounted for should say so forever.';

-- ── resolution: market-specific rule wins, global rule is the fallback ─────────────────────
create or replace function public.resolve_ingredient(p_ingredient text, p_market text)
returns table (item_id uuid, item_name text, factor numeric, shelf_unit text, basis text)
language sql stable security definer set search_path = public as $$
  select m.inventory_item_id, i.name, m.shelf_qty_per_recipe_unit, m.shelf_unit, m.basis
    from public.recipe_ingredient_map m
    join public.inventory_items i on i.id = m.inventory_item_id
   where lower(btrim(m.ingredient)) = lower(btrim(p_ingredient))
     and (m.market = p_market or m.market is null)
     and i.market = p_market            -- the shelf has to be in the city that is brewing
   order by (m.market is null)          -- false sorts first: the market-specific rule wins
   limit 1;
$$;
revoke all on function public.resolve_ingredient(text, text) from public;
grant execute on function public.resolve_ingredient(text, text) to authenticated;

-- ── log what a batch drank ─────────────────────────────────────────────────────────────────
create or replace function public.log_batch_consumption(p_batch_id uuid, p_redo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.brew_batches;
  ing jsonb; nm text; q numeric; u text;
  r record;
  drawn jsonb := '[]'::jsonb;
  gaps  jsonb := '[]'::jsonb;
  lot uuid;
  tid uuid := public.effective_tenant();
  src jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  select * into b from public.brew_batches where id = p_batch_id;
  if not found then raise exception 'No such batch.'; end if;

  if b.consumption_logged_at is not null and not p_redo then
    raise exception 'This batch was already logged on %. Re-logging would draw the same pounds off the shelf twice.',
      to_char(b.consumption_logged_at, 'Mon DD');
  end if;

  -- The scaled list is what this run actually called for. A batch committed before the planner
  -- stored it falls back to the recipe's base list scaled by the run's size.
  src := b.scaled;
  if src is null or jsonb_typeof(src) <> 'array' then
    select case when r2.base_water_gal > 0
                then (select jsonb_agg(jsonb_build_object(
                        'name', e->>'name',
                        'qty',  (coalesce((e->>'qty')::numeric, 0) * b.batch_gal / r2.base_water_gal),
                        'unit', e->>'unit'))
                      from jsonb_array_elements(r2.ingredients) e)
                else r2.ingredients end
      into src
      from public.brew_recipes r2 where r2.id = b.recipe_id;
  end if;
  if src is null or jsonb_typeof(src) <> 'array' then src := '[]'::jsonb; end if;

  for ing in select * from jsonb_array_elements(src) loop
    nm := btrim(coalesce(ing->>'name', ''));
    q  := coalesce((ing->>'qty')::numeric, 0);
    u  := ing->>'unit';
    if nm = '' or q <= 0 then continue; end if;

    select * into r from public.resolve_ingredient(nm, b.market);

    if not found then
      gaps := gaps || jsonb_build_object(
        'ingredient', nm, 'qty', q, 'unit', u,
        'why', case
          when exists (select 1 from public.recipe_ingredient_map m
                        where lower(btrim(m.ingredient)) = lower(nm)
                          and (m.market = b.market or m.market is null))
          then 'mapped, but the shelf it points at is not in ' || b.market
          else 'nothing on any ' || b.market || ' shelf is linked to this ingredient' end);
      continue;
    end if;

    -- Draw from the oldest open lot of that item, so cost follows the coffee that was actually used.
    select l.id into lot
      from public.inventory_lots l
     where l.market = b.market and l.item_name = r.item_name
     order by l.received_on, l.created_at
     limit 1;

    insert into public.inventory_ledger
      (item, market, tenant_id, qty, kind, note, lot_id, batch_id, inventory_item_id, created_by)
    values (r.item_name, b.market, tid, -(q * r.factor), 'use',
            'Batch ' || coalesce(b.recipe_name, b.id::text) || ' — ' || q::text || ' ' ||
            coalesce(u, '') || ' ' || nm, lot, b.id, r.item_id, auth.uid());

    drawn := drawn || jsonb_build_object(
      'ingredient', nm, 'recipe_qty', q, 'recipe_unit', u,
      'item', r.item_name, 'shelf_qty', round(q * r.factor, 6), 'shelf_unit', r.shelf_unit);
  end loop;

  update public.brew_batches
     set consumption_logged_at = now(), consumption_gaps = gaps
   where id = p_batch_id;

  return jsonb_build_object('drawn', drawn, 'gaps', gaps,
                            'drawn_count', jsonb_array_length(drawn),
                            'gap_count', jsonb_array_length(gaps));
end $$;
revoke all on function public.log_batch_consumption(uuid, boolean) from public;
grant execute on function public.log_batch_consumption(uuid, boolean) to authenticated;

comment on function public.log_batch_consumption(uuid, boolean) is
  'Draws a batch''s ingredients off the shelf through the ingredient map and records what it could not draw. Returns both lists so the crew sees the shortfall at the moment it happens.';

-- ── the guard now asks the batch, not the ledger ───────────────────────────────────────────
create or replace function public.guard_batch_accounted() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('served', 'dumped') then return new; end if;
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;

  if new.consumption_logged_at is null then
    raise exception 'Log what this batch used before marking it %. Open the batch and press "Log what it used" — it fills in from the recipe.', new.status
      using errcode = 'check_violation',
            hint = 'Nothing has come off the shelf for this batch yet.';
  end if;
  return new;
end $$;

-- ── remembering a conversion the crew just worked out ──────────────────────────────────────
create or replace function public.map_ingredient(
  p_ingredient text, p_item_id uuid, p_factor numeric, p_basis text,
  p_market text default null, p_recipe_unit text default null
) returns public.recipe_ingredient_map language plpgsql security definer set search_path = public as $$
declare m public.recipe_ingredient_map; su text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_factor, 0) <= 0 then raise exception 'A conversion has to be a positive number.'; end if;
  if coalesce(btrim(p_basis), '') = '' then
    raise exception 'Say where the number came from — a conversion nobody can retrace is a number nobody should trust.';
  end if;
  select unit into su from public.inventory_items where id = p_item_id;

  insert into public.recipe_ingredient_map
    (ingredient, market, inventory_item_id, recipe_unit, shelf_unit,
     shelf_qty_per_recipe_unit, basis, confirmed_by, confirmed_on)
  values (btrim(p_ingredient), p_market, p_item_id, p_recipe_unit, su,
          p_factor, btrim(p_basis), auth.uid(), current_date)
  on conflict (lower(btrim(ingredient)), coalesce(market, '*')) do update
     set inventory_item_id = excluded.inventory_item_id,
         shelf_qty_per_recipe_unit = excluded.shelf_qty_per_recipe_unit,
         basis = excluded.basis, recipe_unit = excluded.recipe_unit,
         shelf_unit = excluded.shelf_unit,
         confirmed_by = excluded.confirmed_by, confirmed_on = excluded.confirmed_on
  returning * into m;
  return m;
end $$;
revoke all on function public.map_ingredient(text, uuid, numeric, text, text, text) from public;
grant execute on function public.map_ingredient(text, uuid, numeric, text, text, text) to authenticated;

-- ── the gap, as a query ────────────────────────────────────────────────────────────────────
-- Every ingredient of every live recipe, against every market, that cannot come off a shelf.
-- The ingredient name is computed once in the inner select and grouped by that column, rather than
-- repeating btrim(ing->>'name') in the select list and the group by: Postgres will not take two
-- spellings of the same expression as the same column.
create or replace view public.v_recipe_ingredient_gaps as
select market, ingredient, recipe_unit,
       string_agg(distinct recipe, ', ' order by recipe) as recipes,
       case
         when bool_and(not linked) then 'no shelf is linked to this ingredient'
         else 'linked, but the shelf it points at is not stocked in this market'
       end as why
  from (
    select mk.slug as market,
           btrim(ing->>'name') as ingredient,
           ing->>'unit'        as recipe_unit,
           r.name              as recipe,
           exists (select 1 from public.recipe_ingredient_map m
                    where lower(btrim(m.ingredient)) = lower(btrim(ing->>'name'))
                      and (m.market = mk.slug or m.market is null)) as linked
      from public.brew_recipes r
      cross join lateral jsonb_array_elements(r.ingredients) ing
      cross join public.markets mk
     where r.archived_at is null
       and btrim(coalesce(ing->>'name', '')) <> ''
       and not exists (select 1 from public.resolve_ingredient(btrim(ing->>'name'), mk.slug))
  ) g
 group by market, ingredient, recipe_unit
 order by market, ingredient;

revoke all on public.v_recipe_ingredient_gaps from public, anon;
grant select on public.v_recipe_ingredient_gaps to authenticated;

comment on view public.v_recipe_ingredient_gaps is
  'Recipe lines that cannot come off any shelf, per market. Every row here is a pound that will be brewed and never subtracted.';

-- v_batch_traceability gains the logged stamp and the shortfall count. Dropped and recreated rather
-- than replaced: create or replace view can only append columns, and this reorders them.
drop view if exists public.v_unaccounted_batches;
drop view if exists public.v_batch_traceability;

create view public.v_batch_traceability as
select b.id as batch_id, b.recipe_name, b.market, b.batch_gal, b.brew_date, b.status, b.signal_score,
       b.consumption_logged_at,
       jsonb_array_length(coalesce(b.consumption_gaps, '[]'::jsonb)) as gap_count,
       coalesce(sum(-l.qty) filter (where l.qty < 0), 0) as qty_used,
       count(distinct l.lot_id) filter (where l.lot_id is not null) as lots_touched,
       string_agg(distinct lo.lot_code, ', ') filter (where lo.lot_code is not null) as lot_codes,
       coalesce(sum(-l.qty * (lo.unit_cost_cents / 100.0)) filter (where l.qty < 0 and lo.unit_cost_cents is not null), 0)::numeric(12,2) as cost_dollars,
       (b.consumption_logged_at is not null) as accounted
  from public.brew_batches b
  left join public.inventory_ledger l on l.batch_id = b.id
  left join public.inventory_lots lo on lo.id = l.lot_id
 group by b.id, b.recipe_name, b.market, b.batch_gal, b.brew_date, b.status, b.signal_score,
          b.consumption_logged_at, b.consumption_gaps
 order by b.brew_date desc nulls last, b.id;

revoke all on public.v_batch_traceability from public, anon;
grant select on public.v_batch_traceability to authenticated;

create view public.v_unaccounted_batches as
select batch_id, recipe_name, market, batch_gal, brew_date, status, gap_count,
       case
         when consumption_logged_at is null and status in ('served','dumped')
           then 'finished without drawing anything down — predates the rule'
         when consumption_logged_at is null then 'not yet accounted for'
         else 'logged, but ' || gap_count::text || ' ingredient(s) could not come off a shelf'
       end as why
  from public.v_batch_traceability
 where consumption_logged_at is null or gap_count > 0
 order by brew_date desc nulls last;

revoke all on public.v_unaccounted_batches from public, anon;
grant select on public.v_unaccounted_batches to authenticated;

-- ── the one conversion that is certain, and only that one ──────────────────────────────────
-- 2.2 lb is stated in the item's own name; 2.2 × 453.59237 = 997.903214 g per bag. One gram of the
-- recipe's nibs is therefore 1/997.903214 = 0.00100210 of a bag. Nothing else here can be derived
-- without a scale or a count, so nothing else is seeded — see v_recipe_ingredient_gaps.
insert into public.recipe_ingredient_map
  (ingredient, market, inventory_item_id, recipe_unit, shelf_unit, shelf_qty_per_recipe_unit, basis)
select 'Organic cacao nibs (mix with grounds)', 'greenville', i.id, 'g', i.unit,
       1 / (2.2 * 453.59237),
       'The item is a 2.2 lb bag by its own name; 2.2 lb = 997.903 g, so 1 g = 1/997.903 of a bag. Arithmetic only — confirm against a real bag before trusting the cost.'
  from public.inventory_items i
 where i.market = 'greenville' and i.name = 'Yupik Organic Raw Cacao Nibs 2.2 lb'
   and not exists (select 1 from public.recipe_ingredient_map m
                    where lower(btrim(m.ingredient)) = lower('Organic cacao nibs (mix with grounds)')
                      and coalesce(m.market,'*') = 'greenville');

-- The three orphan draw-downs from the pre-map brews point at shelves that never existed. They are
-- annotated rather than removed: the ledger is a record of what was believed at the time.
update public.inventory_ledger
   set note = coalesce(note, '') || ' [orphan: this item name matches no shelf; written before the ingredient map existed]'
 where kind = 'use'
   and batch_id is null
   and note not like '%[orphan:%'
   and not exists (select 1 from public.inventory_items i
                    where i.name = public.inventory_ledger.item and i.market = public.inventory_ledger.market);

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A recipe can finally find the shelf','improvement','Prep',
   'Recipes speak in grams and pods; the shelf is a purchase catalogue with pack sizes in its names. Nothing connected the two, so every draw-down ever recorded landed on an item that does not exist and no batch ever moved the stock. There is now one place that says how much of a shelf one unit of an ingredient takes, and every conversion has to say where its number came from. Logging a batch draws what it can and records what it cannot, so a batch that was only partly accounted for says so instead of looking finished. A new list shows every recipe line that still cannot come off a shelf, market by market.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_recipe_ingredient_gaps;
--   select * from public.v_unaccounted_batches;
--   select public.log_batch_consumption('<batch id>');
