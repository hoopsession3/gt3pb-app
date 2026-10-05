-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0347
-- generated-at: 2026-10-05
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0347_a_delivery_lands_on_its_shelf.sql
-- ============================================================
-- ── A DELIVERY LANDS ON ITS SHELF ──────────────────────────────────────────────────────────────
-- 2026-10-05. The form audit, part 3c: the purchase that IS stock.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- 0293 built receive_lot() so a delivery would put a costed lot on its shelf in one act, and 0298
-- wrote down why it matters: a batch costs $0.00 to make wherever inventory_lots — the one place a
-- pound's price can live — has nothing to carry. 0298 priced the one receipt it found by hand
-- (Sprouts #840214: Atlanta's coffee and water). Nothing in the app has ever called receive_lot(): every
-- purchase since was logged as an expense and the shelf was counted by hand — two records of one
-- delivery that never met, and no price for the batch costing to read.
--
-- Calling it as it stood would have been wrong three ways, and the shelf's supplier a fourth:
--   · A SHELF WITH ONLY A HAND COUNT LOST IT. inventory_status reads the ledger's balance when a shelf
--     has any ledger row, and the hand count (inventory_items.qty) only when it has none — and most
--     shelves have none (0293's own reset_inventory_count says so). receive_lot wrote the first one:
--     6 lb received onto a shelf showing 10 made it show 6. The ten already there vanished.
--   · THE LOT DID NOT SAY WHO IT CAME FROM. 0293 predates 0298's vendor and price basis, and wrote
--     neither — so v_ingredient_cost's supplier and terms were blank for every delivery received the
--     way 0293 meant deliveries to be received.
--   · TWO CITIES COULD NOT STOCK ONE ITEM. 0288 made a shelf a city's ("two cities can carry an item
--     of the same name and they are different shelves") and left 0044's unique index on (tenant, name)
--     in place: Atlanta adding the shelf Greenville already has was refused as a duplicate.
--   · A SHELF'S SUPPLIER WAS A TYPED NAME (inventory_items.vendor: 'TricorBraun', 'Amazon'), not a
--     vendor — so nothing could ask what a supplier supplies us.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
--   1. receive_lot() restated with two more arguments, p_vendor_id and p_price_basis. Defaults keep
--      every 0293-shaped call working; the old nine-argument function is dropped so PostgREST never has
--      two to choose between. Under 0318's lock on (item, market):
--        · a shelf with no ledger rows opens its ledger at its hand count first — an 'adjust' row that
--          says so — and the delivery lands on top of what the shelf showed;
--        · the lot carries its supplier (the one given, else the purchase's) and its price basis (the
--          one given, else the supplier's).
--      Everything 0293 refused it still refuses, in 0293's words.
--   2. One shelf name per CITY: the (tenant, name) index becomes (tenant, market, name).
--   3. inventory_items.vendor_id → vendors: the shelf's supplier as a link. Existing rows are linked
--      where their typed name is exactly one active vendor's (case and spacing aside); the rest keep
--      the typed name, and the register offers the link (components/InventoryLibrary).
-- The purchase sheet calls receive_lot from today (components/LogPurchase, "Onto a shelf");
-- scripts/db.receive.test.mjs runs 0293's function to show the loss, then this one.

-- ── 1 · receiving ────────────────────────────────────────────────────────────────────────────────
drop function if exists public.receive_lot(text, text, numeric, text, int, text, uuid, date, text);

create or replace function public.receive_lot(
  p_market text, p_item text, p_qty numeric, p_unit text default null,
  p_unit_cost_cents int default null, p_lot_code text default null,
  p_expense_id uuid default null, p_received_on date default current_date, p_note text default null,
  p_vendor_id uuid default null, p_price_basis text default null
) returns public.inventory_lots language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lots;
  tid   uuid := public.effective_tenant();
  hand  numeric;
  v     uuid;
  basis text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'A delivery has to be more than zero.'; end if;
  if not exists (select 1 from public.inventory_items where name = p_item and market = p_market) then
    raise exception 'No shelf called % in %. Create the item first, so the count has somewhere to land.', p_item, p_market;
  end if;

  -- One shelf at a time: 0318's lock, so a recount and a delivery cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended(p_item || '|' || p_market, 0));

  -- Who it came from and on what terms: what the caller says, else the purchase's supplier.
  v := coalesce(p_vendor_id, (select e.vendor_id from public.expenses e where e.id = p_expense_id));
  basis := coalesce(p_price_basis, (select ven.price_basis from public.vendors ven where ven.id = v));

  -- A shelf only ever counted by hand opens its ledger at that count, so the delivery lands on top of
  -- what the shelf shows instead of replacing it.
  if not exists (select 1 from public.inventory_ledger where item = p_item and market = p_market) then
    select qty into hand from public.inventory_items where name = p_item and market = p_market limit 1;
    if coalesce(hand, 0) <> 0 then
      insert into public.inventory_ledger (item, market, tenant_id, qty, kind, note, created_by)
      values (p_item, p_market, tid, hand, 'adjust',
              'Opening balance: the hand count (' || hand::text || ') before the first delivery was received onto this shelf.',
              auth.uid());
    end if;
  end if;

  insert into public.inventory_lots
    (market, item_name, lot_code, received_on, qty_received, unit, unit_cost_cents, expense_id,
     vendor_id, price_basis, notes, created_by)
  values (p_market, p_item, p_lot_code, coalesce(p_received_on, current_date), p_qty, p_unit, p_unit_cost_cents,
          p_expense_id, v, basis, p_note, auth.uid())
  returning * into l;

  insert into public.inventory_ledger (item, market, tenant_id, qty, kind, note, lot_id, created_by)
  values (p_item, p_market, tid, p_qty, 'restock',
          coalesce(p_note, 'Lot received' || coalesce(' — ' || p_lot_code, '')), l.id, auth.uid());

  return l;
end $$;
revoke all on function public.receive_lot(text, text, numeric, text, int, text, uuid, date, text, uuid, text) from public;
grant execute on function public.receive_lot(text, text, numeric, text, int, text, uuid, date, text, uuid, text) to authenticated;

comment on function public.receive_lot(text, text, numeric, text, int, text, uuid, date, text, uuid, text) is
  'A delivery onto a city''s shelf, in one act: the costed lot (with its supplier and price basis — given, else the purchase''s supplier and that supplier''s terms) and the restock on the ledger. A shelf with no ledger rows opens at its hand count first, so the delivery adds to what the shelf showed (0347).';

-- ── 2 · one shelf name per city ──────────────────────────────────────────────────────────────────
create unique index if not exists inventory_items_tenant_market_name_uniq
  on public.inventory_items (tenant_id, market, name);
drop index if exists public.inventory_tenant_name_uniq;

-- ── 3 · a shelf's supplier is a vendor ───────────────────────────────────────────────────────────
alter table public.inventory_items add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
create index if not exists inventory_items_vendor_idx on public.inventory_items (vendor_id) where vendor_id is not null;

comment on column public.inventory_items.vendor_id is
  'Who this shelf is bought from — a vendor (kind supplier or both). inventory_items.vendor keeps the name as typed before 0347, for rows nobody has linked yet.';

-- Existing rows: linked only where the typed name is exactly one active vendor's in the same tenant.
update public.inventory_items i
   set vendor_id = m.id
  from (
    select v.tenant_id,
           lower(regexp_replace(btrim(v.name), '\s+', ' ', 'g')) as k,
           (array_agg(v.id))[1] as id,
           count(*) as n
      from public.vendors v
     where v.archived_at is null and coalesce(v.status, '') <> 'archived'
     group by 1, 2
  ) m
 where i.vendor_id is null
   and m.n = 1
   and m.tenant_id = i.tenant_id
   and lower(regexp_replace(btrim(coalesce(i.vendor, '')), '\s+', ' ', 'g')) = m.k;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A purchase can go straight onto its shelf, with what it cost','feature','Inventory',
   'Logging a purchase of ingredients or supplies can now put it on the shelf it was bought for, as a delivery that remembers what it cost a pound (or a case) and who it came from. Until now a purchase was only an expense and the shelf was counted separately, so a batch costed out at $0.00 unless someone had priced its receipt by hand. A shelf that had only ever been counted by hand keeps that count and the delivery adds to it. A shelf''s supplier is a pick from the vendor book instead of a typed name, and Atlanta and Greenville can each stock an item of the same name.',
   '2026-10-05', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0347_a_delivery_lands_on_its_shelf',
  'receive_lot() restated with p_vendor_id and p_price_basis (supplier from the purchase, basis from the supplier) and an opening-balance row for a shelf with no ledger, under 0318''s lock; the nine-argument signature dropped. Unique shelf names per (tenant, market, name) instead of (tenant, name). inventory_items.vendor_id, linked where the typed vendor is exactly one active vendor.');

-- verify:
--   select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'receive_lot';                 -- one row, eleven arguments
--   select indexname from pg_indexes where tablename = 'inventory_items' and indexname like '%name_uniq';      -- inventory_items_tenant_market_name_uniq only
--   select count(*) filter (where vendor_id is not null), count(*) from public.inventory_items;               -- typed names that are vendors, linked
