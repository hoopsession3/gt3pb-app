-- ── A BREW NAMES ITS COFFEE ────────────────────────────────────────────────────────────────────
-- 2026-10-05. The form audit, part 3d. Ryan: "if relational database, generate pick list … when I
-- fill out it's hard to know what's relational."
--
-- The coffee lot on Start brew and in the batch log has been a text box since 0086 ("bean origin +
-- roast date / lot #, for traceability") — written down, and read by nothing. Since 0347 every bag of
-- coffee that comes in through Log purchase is a lot on file: its shelf, its city, its supplier, the
-- day it came and what a pound cost. The two never met. Ask "which batches did this bag go into" and
-- the only answer was to read every batch's free text and hope somebody typed the same words.
--
-- And the shelf never moved. log_batch_consumption (0294, 0295) draws a batch's ingredients through
-- the ingredient map, and the coffee line — 'Coarse-ground organic single-origin coffee', 560 g in
-- every recipe — is linked to no shelf in either city (0294 refused to guess a conversion nobody had
-- confirmed, and db.market asserts it is a gap). So every batch ever served left its coffee on the
-- shelf, and the one line that decides how many batches a city can brew was the one line the stock
-- never counted.
--
-- 1. THE LINK. brew_batches.coffee_lot_id → inventory_lots. The text column stays: it is what the
--    production log prints, and it is how a lot that never came in through the app (a bag from
--    before 0347, a sample) is still written down. The app writes both from one pick.
--
-- 2. A LOT A BATCH NAMES IS ITS OWN CITY'S, AND SOMETHING A BREW IS MADE OF. A guard, not a hope:
--    Greenville's batch cannot name a bag that came into Atlanta, and a case of bottles is not a
--    coffee lot. The same refusals 0295 makes of the ingredient map, in words.
--
-- 3. THE DRAW FOLLOWS THE LOT NAMED. When a batch names its lot, its coffee comes off THAT lot, on
--    that lot's shelf — the batch saying where its coffee came from is a more specific fact than any
--    rule, so it wins over the map. How much: the map's conversion when the map already sends this
--    line to that very shelf; otherwise by weight, when both the recipe's unit and the shelf's are
--    weights. Grams to pounds is a definition (the pound is 453.59237 g), not an estimate, so this is
--    not the guess 0294 refused — it is the same arithmetic lib/brewMath already does for the cook.
--    A shelf counted in bags or cases does not convert by weight, and the line stays a gap that says
--    so. Every other line keeps 0295's rule, except that a line whose shelf IS the named lot's comes
--    off the named lot rather than the oldest one there.
--
--    WHICH LINE IS THE COFFEE is lib/brewMath's rule (isCoffee — the line a batch is sized by) and
--    WHAT A GRAM IS lib/brewMath's table (TO_GRAMS). SQL cannot import TypeScript, so each is stated
--    here once as a function, and scripts/db.brewlot.test.mjs holds the two languages to one answer:
--    it reads TO_GRAMS out of lib/brewMath.ts and checks every unit, and both it and scripts/smoke.cjs
--    run the same list of names (scripts/fixtures/coffee-names.json) through their side's rule.
--
-- WHEN STOCK MOVES is not changed here: a batch draws when it logs what it used, which serving or
-- dumping it asks for (0294's guard). The draw the brew route attempts when a batch is planned has
-- never run — it calls this function with the service key, and is_staff() is false without a
-- signed-in person — and drawing at plan time would be wrong anyway. The owner's call is brew time;
-- that is its own commit.

-- ── 1) the link ────────────────────────────────────────────────────────────────────────────────
alter table public.brew_batches
  add column if not exists coffee_lot_id uuid references public.inventory_lots(id) on delete set null;

create index if not exists brew_batches_coffee_lot_idx
  on public.brew_batches (coffee_lot_id) where coffee_lot_id is not null;

comment on column public.brew_batches.coffee_lot_id is
  'The delivery this batch''s coffee came from (0349). coffee_lot keeps the words the log prints; a lot that never came in through the app is written there alone.';

-- ── 2) the two rules lib/brewMath keeps, stated once for SQL ───────────────────────────────────
-- lib/brewMath.isCoffee: /\bcoffee\b|\bbean/i. \m and \M are Postgres's word starts and ends.
create or replace function public.is_coffee(p_name text) returns boolean
  language sql immutable set search_path = public as $$
  select coalesce(p_name, '') ~* '\mcoffee\M|\mbean'
$$;

-- lib/brewMath TO_GRAMS: exact definitions, not approximations. Null for anything that is not a
-- weight — a gallon of water has no weight without a density, and nothing here may invent one.
create or replace function public.grams_per(p_unit text) returns numeric
  language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_unit, '')))
    when 'g' then 1::numeric when 'gram' then 1::numeric when 'grams' then 1::numeric
    when 'kg' then 1000::numeric when 'kilogram' then 1000::numeric when 'kilograms' then 1000::numeric
    when 'oz' then 28.349523125 when 'ounce' then 28.349523125 when 'ounces' then 28.349523125
    when 'lb' then 453.59237 when 'lbs' then 453.59237 when 'pound' then 453.59237 when 'pounds' then 453.59237
    else null end
$$;

-- ── 3) a lot named on a batch is its own city's, and something a brew is made of ───────────────
create or replace function public.brew_coffee_lot_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare l public.inventory_lots; k text;
begin
  if new.coffee_lot_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.coffee_lot_id is not distinct from old.coffee_lot_id
     and new.market is not distinct from old.market then
    return new;
  end if;

  select * into l from public.inventory_lots where id = new.coffee_lot_id;
  if not found then raise exception 'That lot is not on file.'; end if;

  if l.market is distinct from new.market then
    raise exception 'That lot came into %, and this batch is brewing in %. A batch''s coffee comes off its own city''s shelf.',
      coalesce((select m.name from public.markets m where m.slug = l.market), l.market),
      coalesce((select m.name from public.markets m where m.slug = new.market), new.market);
  end if;

  select i.kind into k from public.inventory_items i
   where i.market = l.market and i.name = l.item_name and i.tenant_id is not distinct from l.tenant_id
   limit 1;
  if k in ('equipment', 'consumable', 'packaging') then
    raise exception '% is %, not something a brew is made of.', l.item_name,
      case k when 'consumable' then 'a supply' else k end;
  end if;
  return new;
end $$;
-- A trigger's function, and nothing else's: it runs as its owner so it can read the lot whatever
-- city the person saving is scoped to, and no role calls it directly.
revoke all on function public.brew_coffee_lot_guard() from public, anon, authenticated;

drop trigger if exists brew_coffee_lot_guard on public.brew_batches;
create trigger brew_coffee_lot_guard
  before insert or update of coffee_lot_id, market on public.brew_batches
  for each row execute function public.brew_coffee_lot_guard();

-- ── 4) the draw follows the lot named ──────────────────────────────────────────────────────────
-- 0295's function, with the named lot. Everything a batch that names no lot does is unchanged, and
-- the test runs 0295's version and this one side by side on the same batches to show it.
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
  named public.inventory_lots;   -- 0349: the lot the batch names
  shelf public.inventory_items;  -- 0349: and the shelf it is on
  f numeric;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  select * into b from public.brew_batches where id = p_batch_id;
  if not found then raise exception 'No such batch.'; end if;

  if b.consumption_logged_at is not null and not p_redo then
    raise exception 'This batch was already logged on %. Re-logging would draw the same pounds off the shelf twice.',
      to_char(b.consumption_logged_at, 'Mon DD');
  end if;

  -- The scaled list is what this run actually called for. A batch committed before the planner
  -- stored it falls back to the recipe's base list — scaled by the run's size ONLY for lines that
  -- scale. A filter is one filter whether the batch is one gallon or five; multiplying it was the
  -- defect 0295 corrected.
  src := b.scaled;
  if src is null or jsonb_typeof(src) <> 'array' then
    select (select jsonb_agg(jsonb_build_object(
              'name', e->>'name',
              'qty',  case when (e->>'scales') = 'false' or r2.base_water_gal <= 0
                           then coalesce((e->>'qty')::numeric, 0)
                           else coalesce((e->>'qty')::numeric, 0) * b.batch_gal / r2.base_water_gal end,
              'unit', e->>'unit'))
            from jsonb_array_elements(r2.ingredients) e)
      into src
      from public.brew_recipes r2 where r2.id = b.recipe_id;
  end if;
  if src is null or jsonb_typeof(src) <> 'array' then src := '[]'::jsonb; end if;

  -- 0349: the lot the batch names — in the batch's city, as the guard keeps it — and its shelf.
  if b.coffee_lot_id is not null then
    select * into named from public.inventory_lots where id = b.coffee_lot_id and market = b.market;
    if found then
      select * into shelf from public.inventory_items i
       where i.market = named.market and i.name = named.item_name
         and i.tenant_id is not distinct from named.tenant_id
       limit 1;
    end if;
  end if;

  for ing in select * from jsonb_array_elements(src) loop
    nm := btrim(coalesce(ing->>'name', ''));
    q  := coalesce((ing->>'qty')::numeric, 0);
    u  := ing->>'unit';
    if nm = '' or q <= 0 then continue; end if;

    -- 0349: THE COFFEE, OFF THE LOT THE BATCH NAMES.
    if named.id is not null and public.is_coffee(nm) then
      if shelf.id is null then
        gaps := gaps || jsonb_build_object('ingredient', nm, 'qty', q, 'unit', u, 'lot_id', named.id,
          'why', 'the lot named on the batch is on a shelf that is not in the ' || b.market || ' register');
        continue;
      end if;
      if not public.is_coffee(named.item_name) then
        gaps := gaps || jsonb_build_object('ingredient', nm, 'qty', q, 'unit', u, 'lot_id', named.id,
          'why', named.item_name || ' is not a coffee shelf by its name, so the coffee was not drawn off it');
        continue;
      end if;
      select * into r from public.resolve_ingredient(nm, b.market);
      if found and r.item_id = shelf.id then
        f := r.factor;                                            -- the map already says this shelf
      else
        f := public.grams_per(u) / public.grams_per(shelf.unit);  -- null unless both are weights
      end if;
      if f is null or f <= 0 then
        gaps := gaps || jsonb_build_object('ingredient', nm, 'qty', q, 'unit', u, 'lot_id', named.id,
          'why', 'the lot named on the batch is counted in ' || coalesce(nullif(btrim(shelf.unit), ''), 'no unit')
                 || ', and ' || coalesce(nullif(btrim(u), ''), 'this amount') || ' does not convert to it by weight');
        continue;
      end if;

      insert into public.inventory_ledger
        (item, market, tenant_id, qty, kind, note, lot_id, batch_id, inventory_item_id, created_by)
      values (named.item_name, b.market, tid, -(q * f), 'use',
              'Batch ' || coalesce(b.recipe_name, b.id::text) || ' — ' || q::text || ' ' ||
              coalesce(u, '') || ' ' || nm || ' (off the lot the batch names)', named.id, b.id, shelf.id, auth.uid());

      drawn := drawn || jsonb_build_object(
        'ingredient', nm, 'recipe_qty', q, 'recipe_unit', u,
        'item', named.item_name, 'shelf_qty', round(q * f, 6), 'shelf_unit', shelf.unit, 'lot_id', named.id);
      continue;
    end if;

    select * into r from public.resolve_ingredient(nm, b.market);

    if not found then
      gaps := gaps || jsonb_build_object(
        'ingredient', nm, 'qty', q, 'unit', u,
        'why', case
          when exists (select 1 from public.recipe_ingredient_map m
                        join public.inventory_items i on i.id = m.inventory_item_id
                       where lower(btrim(m.ingredient)) = lower(nm)
                         and (m.market = b.market or m.market is null)
                         and i.kind = 'equipment')
          then 'linked to equipment, which a batch does not use up'
          when exists (select 1 from public.recipe_ingredient_map m
                        where lower(btrim(m.ingredient)) = lower(nm)
                          and (m.market = b.market or m.market is null))
          then 'mapped, but the shelf it points at is not in ' || b.market
          -- 0349: the coffee says what would draw it.
          when public.is_coffee(nm)
          then 'no coffee lot named on the batch, and nothing on any ' || b.market || ' shelf is linked to this ingredient'
          else 'nothing on any ' || b.market || ' shelf is linked to this ingredient' end);
      continue;
    end if;

    -- 0349: off the lot the batch names when this line's shelf is that lot's; else the oldest there.
    lot := null;
    if named.id is not null and named.item_name = r.item_name then lot := named.id; end if;
    if lot is null then
      select l.id into lot
        from public.inventory_lots l
       where l.market = b.market and l.item_name = r.item_name
       order by l.received_on, l.created_at
       limit 1;
    end if;

    insert into public.inventory_ledger
      (item, market, tenant_id, qty, kind, note, lot_id, batch_id, inventory_item_id, created_by)
    values (r.item_name, b.market, tid, -(q * r.factor), 'use',
            'Batch ' || coalesce(b.recipe_name, b.id::text) || ' — ' || q::text || ' ' ||
            coalesce(u, '') || ' ' || nm, lot, b.id, r.item_id, auth.uid());

    drawn := drawn || jsonb_build_object(
      'ingredient', nm, 'recipe_qty', q, 'recipe_unit', u,
      'item', r.item_name, 'shelf_qty', round(q * r.factor, 6), 'shelf_unit', r.shelf_unit, 'lot_id', lot);
  end loop;

  update public.brew_batches
     set consumption_logged_at = now(), consumption_gaps = gaps
   where id = p_batch_id;

  return jsonb_build_object('drawn', drawn, 'gaps', gaps,
                            'drawn_count', jsonb_array_length(drawn),
                            'gap_count', jsonb_array_length(gaps));
end $$;
-- 0295 revoked it from public only, and Supabase grants every new function to anon by name — so a
-- stranger could call this (to be told "staff only" by is_staff). Restated, it is the crew's alone.
revoke all on function public.log_batch_consumption(uuid, boolean) from public, anon;
grant execute on function public.log_batch_consumption(uuid, boolean) to authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A brew names the coffee it was made from','feature','Brew',
   'Starting a brew now asks which bag of coffee it is — picked from the deliveries logged in that city, filled in with the one the last brew used. The batch keeps a link to that delivery instead of a typed note, so a bag can be traced to every batch it went into. When the batch logs what it used, its coffee comes off that bag''s shelf, by weight; until now no batch''s coffee was ever taken off the shelf at all. A lot that never came in through the app can still be typed.',
   '2026-10-05', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0349_a_brew_names_its_coffee',
  'brew_batches.coffee_lot_id → inventory_lots (on delete set null), guarded to the batch''s city and to a shelf a brew is made of. log_batch_consumption: a batch that names its lot draws its coffee off that lot (the map''s conversion when it points at that shelf, else by weight — grams_per, lib/brewMath''s table), and a line whose shelf is the named lot''s comes off it; otherwise 0295 unchanged. is_coffee and grams_per state lib/brewMath''s two rules for SQL.');

-- verify:
--   select count(*) from public.brew_batches where coffee_lot_id is not null;                 -- 0 until a brew names one
--   select public.is_coffee('Coarse-ground organic single-origin coffee'), public.grams_per('lb'); -- true, 453.59237
--   select tgname from pg_trigger where tgrelid = 'public.brew_batches'::regclass and tgname = 'brew_coffee_lot_guard';
