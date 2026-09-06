-- 0295 — Four lifecycles on one shelf.
--
-- WHAT THE ATLANTA STARTER PACK SHOWED. The owner's bare-minimum list for opening Atlanta reads as
-- one list — two Toddys, paper filters, a steel table, cinnamon, cacao, a grinder, coffee socks,
-- sample bottles, GT3 bottles — but those items do not behave alike, and inventory_items has been
-- treating them as if they did. The question that separates them is what EVENT depletes the thing:
--
--   ingredient  — depleted in proportion to gallons brewed (cacao, cinnamon, cardamom, coffee)
--   consumable  — depleted by a brew or a shift happening at all, not by its size (filters, socks,
--                 sanitiser). The recipe schema has carried a 'scales: false' flag for these since
--                 0079; nothing was ever linked to a shelf to receive the draw.
--   equipment   — never depleted. A Toddy, a table, a grinder. Counting one is a census, not a
--                 balance, and a reorder point on it is meaningless.
--   packaging   — depleted when a bottle is filled and sold, which is neither of the above triggers.
--
-- Conflating them is not cosmetic. A reorder alert on a steel table is noise that trains the crew to
-- ignore alerts. A recipe line that resolves to the grinder would draw the grinder down to zero.
--
-- WHERE THE CLASSIFICATION COMES FROM. Not from guessing at names: the category column already
-- carries the answer for 46 of the 49 items, and it was filled in by hand by someone who knew what
-- each thing was. Ingredients → ingredient, Packaging → packaging, Brewing Equipment / Tools&Hardware
-- / Cooler&Display → equipment, Cleaning&Sanitation → consumable. The remaining four — one Marketing
-- item, one Office/Software item, one uncategorised — are left NULL rather than forced into a bucket
-- they may not belong in, and v_item_kind_gaps names them. Office/Software in particular is probably
-- a subscription and not a shelf at all; that is the owner's call, not a regex's.
--
-- THE SCALING DEFECT THIS ALSO FIXES. log_batch_consumption's fallback path (used when a batch has no
-- stored scaled list) multiplied EVERY ingredient by batch_gal / base_water_gal, ignoring the
-- 'scales' flag. The planner honours it; the fallback did not. Latent so far because all ten current
-- recipe lines scale — and about to stop being latent the moment a filter is added as a recipe line,
-- which the Atlanta list implies is next. It would have drawn four filters for a 4-gallon batch of a
-- recipe defined per 1 gallon.

-- ── what kind of thing is this ─────────────────────────────────────────────────────────────────
alter table public.inventory_items add column if not exists kind text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_kind_ck') then
    alter table public.inventory_items add constraint inventory_items_kind_ck
      check (kind is null or kind in ('ingredient','consumable','equipment','packaging'));
  end if;
end $$;

update public.inventory_items set kind = case
    when category = 'Ingredients'                                        then 'ingredient'
    when category = 'Packaging'                                          then 'packaging'
    when category in ('Brewing Equipment','Tools/Hardware','Cooler/Display') then 'equipment'
    when category = 'Cleaning/Sanitation'                                then 'consumable'
  end
 where kind is null and category is not null;

comment on column public.inventory_items.kind is
  'What event depletes this: gallons brewed (ingredient), a brew or shift happening (consumable), nothing (equipment), a bottle sold (packaging). NULL means nobody has said yet — see v_item_kind_gaps.';

create index if not exists inventory_items_kind_idx on public.inventory_items (market, kind);

-- ── equipment does not get reordered ───────────────────────────────────────────────────────────
-- Identical to 0288's alert in every other respect; the single new clause is the equipment skip.
-- A steel table has no reorder point that means anything, and an alert nobody can act on is an alert
-- everybody learns to swipe away.
create or replace function public.inventory_reorder_alert() returns trigger
  language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; oh numeric; ttl text;
begin
  select * into it from public.inventory_items
   where name = new.item and tenant_id = new.tenant_id and market = new.market limit 1;
  if not found or it.reorder_point is null then return new; end if;
  if it.kind = 'equipment' then return new; end if;

  select coalesce(sum(qty), 0) into oh from public.inventory_ledger
   where item = new.item and tenant_id = new.tenant_id and market = new.market;

  ttl := '📦 Reorder — ' || it.name
         || case when it.market <> 'greenville' then ' (' || it.market || ')' else '' end;

  if oh <= it.reorder_point then
    if not exists (select 1 from public.alerts
                     where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = ttl) then
      insert into public.alerts (severity, category, title, body, link, target_user_id, tenant_id)
      values (case when oh <= 0 then 'critical' else 'important' end,
              'prep', ttl,
              it.name || ' is down to ' || oh::text || coalesce(' ' || it.unit, '') ||
                ' (reorder at ' || it.reorder_point::text || ').' ||
                case when it.reorder_link is not null then ' Reorder link is on the item.' else '' end,
              '/admin', null, it.tenant_id);
    end if;
  else
    update public.alerts set ack_at = now(), ack_by = new.created_by
      where ack_at is null and category = 'prep' and tenant_id = it.tenant_id and title = ttl;
  end if;
  return new;
end $$;

-- ── a recipe may not draw down the grinder ─────────────────────────────────────────────────────
create or replace function public.map_ingredient(
  p_ingredient text, p_item_id uuid, p_factor numeric, p_basis text,
  p_market text default null, p_recipe_unit text default null
) returns public.recipe_ingredient_map language plpgsql security definer set search_path = public as $$
declare m public.recipe_ingredient_map; su text; k text; nm text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_factor, 0) <= 0 then raise exception 'A conversion has to be a positive number.'; end if;
  if coalesce(btrim(p_basis), '') = '' then
    raise exception 'Say where the number came from — a conversion nobody can retrace is a number nobody should trust.';
  end if;

  select unit, kind, name into su, k, nm from public.inventory_items where id = p_item_id;
  if nm is null then raise exception 'No such item.'; end if;
  if k = 'equipment' then
    raise exception '% is equipment, not something a batch uses up. Linking a recipe to it would count the % down to zero.', nm, nm;
  end if;

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

-- resolve_ingredient refuses to hand back an equipment shelf, so a map row written before this rule
-- existed cannot draw one down either.
create or replace function public.resolve_ingredient(p_ingredient text, p_market text)
returns table (item_id uuid, item_name text, factor numeric, shelf_unit text, basis text)
language sql stable security definer set search_path = public as $$
  select m.inventory_item_id, i.name, m.shelf_qty_per_recipe_unit, m.shelf_unit, m.basis
    from public.recipe_ingredient_map m
    join public.inventory_items i on i.id = m.inventory_item_id
   where lower(btrim(m.ingredient)) = lower(btrim(p_ingredient))
     and (m.market = p_market or m.market is null)
     and i.market = p_market
     and coalesce(i.kind, '') <> 'equipment'
   order by (m.market is null)
   limit 1;
$$;
revoke all on function public.resolve_ingredient(text, text) from public;
grant execute on function public.resolve_ingredient(text, text) to authenticated;

-- ── the scaling fix ────────────────────────────────────────────────────────────────────────────
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
  -- stored it falls back to the recipe's base list — scaled by the run's size ONLY for lines that
  -- scale. A filter is one filter whether the batch is one gallon or five; multiplying it was the
  -- defect this migration corrects.
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
                        join public.inventory_items i on i.id = m.inventory_item_id
                       where lower(btrim(m.ingredient)) = lower(nm)
                         and (m.market = b.market or m.market is null)
                         and i.kind = 'equipment')
          then 'linked to equipment, which a batch does not use up'
          when exists (select 1 from public.recipe_ingredient_map m
                        where lower(btrim(m.ingredient)) = lower(nm)
                          and (m.market = b.market or m.market is null))
          then 'mapped, but the shelf it points at is not in ' || b.market
          else 'nothing on any ' || b.market || ' shelf is linked to this ingredient' end);
      continue;
    end if;

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

-- ── a vessel belongs to a city ─────────────────────────────────────────────────────────────────
-- Same defect 0288 fixed for the shelf: two rows served both cities, so "does Atlanta have its two
-- Toddys" was unanswerable and the planner could not know a city's ceiling. Both existing vessels
-- are Greenville's — they were bought and used there long before Atlanta was a market.
alter table public.brew_vessels add column if not exists market text;
update public.brew_vessels set market = 'greenville' where market is null;
alter table public.brew_vessels alter column market set default 'greenville';
alter table public.brew_vessels alter column market set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brew_vessels_market_fk') then
    alter table public.brew_vessels add constraint brew_vessels_market_fk
      foreign key (market) references public.markets(slug);
  end if;
end $$;

create index if not exists brew_vessels_market_idx on public.brew_vessels (market);

-- The biggest single vessel is the real ceiling on one batch; the sum is the ceiling on one day's
-- brewing across vessels. Both are null for a city with no vessels, which is not the same as zero
-- and is why this returns null rather than 0.
create or replace function public.market_brew_capacity(p_market text)
returns table (vessels int, largest_gal numeric, total_gal numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::int, max(capacity_gal), sum(capacity_gal)
    from public.brew_vessels
   where market = p_market and archived_at is null;
$$;
revoke all on function public.market_brew_capacity(text) from public;
grant execute on function public.market_brew_capacity(text) to authenticated;

-- ── the gap, as a query ────────────────────────────────────────────────────────────────────────
create or replace view public.v_item_kind_gaps as
select id, name, market, category, qty, unit
  from public.inventory_items
 where kind is null
 order by market, coalesce(category, '~'), name;

revoke all on public.v_item_kind_gaps from public, anon;
grant select on public.v_item_kind_gaps to authenticated;

comment on view public.v_item_kind_gaps is
  'Items nobody has said what kind of thing they are. Until one is classified it gets reorder alerts it may not deserve and cannot be drawn by a batch.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The shelf knows the difference between a bag of cacao and a steel table','improvement','Prep',
   'Everything on the shelf was tracked the same way, whether it gets used up by brewing, used up by a shift, sold in a bottle, or never used up at all. Each item now says which it is, and the difference has teeth: equipment no longer raises reorder alerts nobody can act on, and a recipe can no longer be linked to the grinder and count it down to zero. Vessels belong to a city now, the way stock already did, so a city''s brewing capacity is a real number instead of a shared guess. Also fixed: a batch with no stored ingredient list would have multiplied its paper filters by the batch size, which is not how a filter works.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select kind, count(*) from public.inventory_items group by 1 order by 2 desc;
--   select * from public.v_item_kind_gaps;
--   select * from public.market_brew_capacity('greenville');
