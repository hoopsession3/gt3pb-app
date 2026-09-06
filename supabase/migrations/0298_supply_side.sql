-- 0298 — The company we buy from had nowhere to live.
--
-- THE VENDORS TABLE IS SELL-SIDE. All seventeen rows in public.vendors are places GT3 sells at or
-- to — ACA Sports Club, Euphoria Office, Corporate Coffee Program, Back to Nine, a vendor market.
-- The table's own columns say so: service_dates, location_text, lat/lng. It was built in 0034 to
-- answer "where are we pouring", and it has been quietly doing double duty as the only place a
-- company name can be written down.
--
-- So the actual supplier — Sprouts, where the coffee is bought by the individual retail bag until a
-- wholesale deal is struck — was not in it, and the three expense lines from receipt #840214 all
-- read "(no vendor linked)".
--
-- THE PRICE WAS TRAPPED IN A SENTENCE. The receipt was itemised honestly and reconciles to $170.90:
-- 6 lb of coffee at $15.99/lb, 2 cases of water at $34.99, $4.98 of tax. But that $15.99 lives in an
-- expense DESCRIPTION, and inventory_lots — the table 0293 built to hold exactly this, with a
-- unit_cost_cents column feeding v_batch_traceability.cost_dollars — was empty. Every batch in the
-- app therefore costs $0.00 to make. The chain from a pound to a bottle was built and then never
-- given a single number to carry.
--
-- WHY THE BASIS IS A COLUMN AND NOT AN ADJECTIVE. "Retail" was a word in a description. The point of
-- recording it is comparison: buying retail from a third party is the INTERIM arrangement, and when
-- the wholesale deal is struck the only way to say what it was worth is to have the retail number
-- stored as retail, per lot, next to the vendor it came from. A basis kept as prose can be read by a
-- person and by nothing else. Kept on the lot as well as the vendor, because after a deal lands the
-- shelf holds some of both and the comparison is lot to lot.
--
-- THE FOUR POUNDS WITH NO RECEIPT. Four of the ten pounds on the Atlanta shelf came in as opening
-- stock with nothing to price them against. The owner's call is to value them at the same $15.99, so
-- that is what they carry — with the assumption written into the lot's own notes rather than left to
-- be rediscovered later as a number nobody can source.

-- ── which side of the business is this company on ──────────────────────────────────────────────
alter table public.vendors add column if not exists kind text;
alter table public.vendors add column if not exists price_basis text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_kind_ck') then
    alter table public.vendors add constraint vendors_kind_ck
      check (kind is null or kind in ('supplier','venue','both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_price_basis_ck') then
    alter table public.vendors add constraint vendors_price_basis_ck
      check (price_basis is null or price_basis in ('retail','wholesale','distributor'));
  end if;
end $$;

-- Every existing row is a place, not a supplier — that is what service_dates and lat/lng are for.
-- Reversible with one update if any of them turns out to sell us something.
update public.vendors set kind = 'venue' where kind is null;

comment on column public.vendors.kind is
  'Which side of the business this company sits on: somewhere we sell (venue), somewhere we buy from (supplier), or both. Everything predating 0298 is a venue — the table was built for where we pour.';
comment on column public.vendors.price_basis is
  'What a supplier charges us against: retail (buying off the shelf like anyone else), wholesale, or distributor. The interim retail arrangement has to be stored as retail for a future deal to be measurable against it.';

insert into public.vendors (name, kind, price_basis, notes, sort)
select 'Sprouts Farmers Market', 'supplier', 'retail',
       'Third-party retailer. Coffee and water are bought here by the individual retail bag, at shelf price, until a wholesale supply deal is struck. Every lot sourced here carries price_basis = retail so the eventual deal can be measured against it.',
       0
 where not exists (select 1 from public.vendors where lower(name) like 'sprouts%');

-- ── the receipt becomes a costed delivery ──────────────────────────────────────────────────────
alter table public.inventory_lots add column if not exists price_basis text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_price_basis_ck') then
    alter table public.inventory_lots add constraint inventory_lots_price_basis_ck
      check (price_basis is null or price_basis in ('retail','wholesale','distributor'));
  end if;
end $$;
comment on column public.inventory_lots.price_basis is
  'What this particular delivery was priced against. Kept per lot, not only per vendor: once a wholesale deal lands the shelf holds lots of both kinds and the saving is a lot-to-lot comparison.';

-- Link the three lines of Sprouts #840214 to the supplier they came from.
update public.expenses e
   set vendor_id = (select id from public.vendors where lower(name) like 'sprouts%' limit 1)
 where e.vendor_id is null
   and coalesce(e.description, '') like '%840214%';

-- The lots themselves. Inserted directly rather than through receive_lot() ON PURPOSE: that function
-- also writes an inventory_ledger row, and the ledger already carries these arrivals (+6 lb, +2
-- cases, +4 lb) from when the receipt was first logged. Calling it would double the shelf. What is
-- missing is not the movement, it is the cost attached to it.
insert into public.inventory_lots
  (market, item_name, lot_code, received_on, qty_received, unit, unit_cost_cents, price_basis,
   vendor_id, expense_id, notes)
select v.market, v.item_name, v.lot_code, v.received_on::date, v.qty, v.unit, v.cents, 'retail',
       (select id from public.vendors where lower(name) like 'sprouts%' limit 1),
       (select e.id from public.expenses e
         where coalesce(e.description,'') like v.expense_like limit 1),
       v.notes
from (values
  ('atlanta', 'Org Ethiopia Coffee (bulk)', 'SPROUTS-840214', '2026-09-06', 6::numeric, 'lb',  1599,
   '%Org Ethiopia%840214%', 'Sprouts #840214 — 6 lb at $15.99/lb shelf price.'),
  ('atlanta', 'Spring Water Case',          'SPROUTS-840214', '2026-09-06', 2::numeric, 'case', 3499,
   '%Spring water%840214%', 'Sprouts #840214 — 2 cases at $34.99.'),
  -- The four pounds already on hand. Valued at the Sprouts shelf price by the owner's call; there is
  -- no receipt behind this number and the note says so, so nobody later mistakes it for one.
  ('atlanta', 'Org Ethiopia Coffee (bulk)', 'OPENING-2026-09-06', '2026-09-06', 4::numeric, 'lb', 1599,
   'ZZZ-no-expense-ZZZ',
   'Opening stock, no receipt on file. Valued at the same $15.99/lb Sprouts retail rate by the owner''s decision — an assumption, not a documented cost.')
) as v(market, item_name, lot_code, received_on, qty, unit, cents, expense_like, notes)
where not exists (
  select 1 from public.inventory_lots l
   where l.market = v.market and l.item_name = v.item_name and l.lot_code = v.lot_code);

-- Point the arrival rows at the lots they were. The restock rows ARE these deliveries; the opening
-- adjust row is the four pounds. Matching on quantity keeps each ledger row tied to its own lot.
update public.inventory_ledger l
   set lot_id = lo.id
  from public.inventory_lots lo
 where l.lot_id is null
   and l.market = lo.market
   and l.item = lo.item_name
   and l.qty = lo.qty_received
   and l.qty > 0;

-- ── what a pound costs today, and on what terms ────────────────────────────────────────────────
-- The number a future wholesale deal gets measured against. One row per stocked ingredient per
-- market, carrying the most recent costed lot, who it came from and what it was priced against.
create or replace view public.v_ingredient_cost as
select i.market,
       i.name as item,
       i.unit,
       i.kind,
       l.unit_cost_cents,
       (l.unit_cost_cents / 100.0)::numeric(12,2) as unit_cost,
       l.price_basis,
       ven.name as supplier,
       l.received_on as priced_on,
       l.lot_code,
       (l.expense_id is not null) as receipted,
       case
         when l.unit_cost_cents is null then 'no costed lot — batches drawing this cost nothing'
         when l.expense_id is null      then 'costed, but from an assumption rather than a receipt'
         when l.price_basis = 'retail'  then 'retail shelf price from a third party'
         else 'on supplier terms'
       end as cost_note
  from public.inventory_items i
  left join lateral (
    select lo.* from public.inventory_lots lo
     where lo.market = i.market and lo.item_name = i.name and lo.unit_cost_cents is not null
     order by lo.received_on desc, lo.created_at desc
     limit 1
  ) l on true
  left join public.vendors ven on ven.id = l.vendor_id
 where i.kind in ('ingredient','consumable','packaging')
 order by i.market, i.name;

revoke all on public.v_ingredient_cost from public, anon;
grant select on public.v_ingredient_cost to authenticated;

comment on view public.v_ingredient_cost is
  'What each stocked item currently costs per unit, from its most recent costed delivery, with the supplier and the terms. A row with no cost is a row whose batches come out free, which no batch is.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The company we buy from is in the books now','improvement','Money',
   'The vendor list held seventeen companies and every one of them was somewhere we sell — the supplier we actually buy the coffee from was not in it, so the purchases showed no vendor at all. Suppliers and venues are now told apart, and a supplier records what it charges us against: buying retail off the shelf until a wholesale deal is struck is now a fact the app holds rather than a note in a description. The Sprouts receipt has become real deliveries carrying $15.99 a pound, so a batch finally costs what it costs instead of costing nothing.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_ingredient_cost where market = 'atlanta';
--   select name, kind, price_basis from public.vendors where kind = 'supplier';
--   select item_name, qty_received, unit_cost_cents, price_basis, lot_code from public.inventory_lots;
