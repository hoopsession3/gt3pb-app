-- ── AN OFFICE KEEPS ITS CITY AND ITS DOOR ───────────────────────────────────────────────────────
-- 2026-10-04. Found by the form audit, tracing where the office order form's fields go.
--
-- ── WHAT WAS TRUE ──────────────────────────────────────────────────────────────────────────────
-- Two facts an office types into its first order did not survive to its second.
--
--   THE DOOR. "Suite 300 — badge in at the front desk" is business_orders.access_instructions. The
--   standing account (business_accounts, 0187) had no column for it, and generate_office_route
--   (0188, restated by 0206 and 0282) builds each Monday's order from the ACCOUNT. So the first
--   order carried the notes and every order the generator made after it reached the door without
--   them — the driver at a locked lobby at 5 AM, every week, for every standing office.
--
--   THE CITY. app/api/office resolves which market a ZIP belongs to (lib/delivery.zipMarket) and
--   then never wrote it: business_accounts.market and business_orders.market took the column default
--   from 0275 — 'greenville' — for every office anywhere. Atlanta opens on corporate standing orders
--   only (lib/markets), so the market's whole opening plan was filed under Greenville; and 0282
--   prices and schedules a standing account by THAT account's market, so an Atlanta account was
--   priced and windowed from Greenville's row. The route writes the market from today
--   (app/api/office); this corrects what it wrote before.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
--   1. business_accounts.access_instructions — the account keeps its door. The route writes it with
--      the rest of a standing account (arrives-with: 0346, lib/schemaSkew until this is applied).
--   2. generate_office_route restated VERBATIM from 0282 with one change: the order it inserts
--      carries the account's access_instructions. Everything else — the staff gate, the standing
--      filter, the duplicate guard, the 3-gallon floor, the per-market price and window, the zero fee
--      and tax — is 0282's, character for character (scripts/db.office.test.mjs compares the text).
--   3. Existing rows. Each account takes the notes from its latest order to the SAME street (notes
--      belong to a door; an office that moved does not inherit its old lobby's code). Accounts and
--      orders whose ZIP is on Atlanta's route list (lib/delivery MARKET_ZIPS.atlanta — the list the
--      route itself checks, copied below and compared by the test) move from the default to
--      'atlanta'. Only rows still on the default move; nothing anybody set is touched.

alter table public.business_accounts add column if not exists access_instructions text;

comment on column public.business_accounts.access_instructions is
  'How to get in — suite, badge, dock, gate code. The weekly generator copies it onto every standing order (0346). It lived only on the first order until 0346.';

-- ── existing rows: the door ───────────────────────────────────────────────────────────────────────
update public.business_accounts a
   set access_instructions = o.access_instructions
  from (
    select distinct on (business_id) business_id, access_instructions, address_street
      from public.business_orders
     where business_id is not null and nullif(btrim(coalesce(access_instructions, '')), '') is not null
     order by business_id, created_at desc
  ) o
 where o.business_id = a.id
   and a.access_instructions is null
   and lower(btrim(coalesce(o.address_street, ''))) = lower(btrim(coalesce(a.address_street, '')));

-- ── existing rows: the city ───────────────────────────────────────────────────────────────────────
-- lib/delivery MARKET_ZIPS.atlanta, as of this migration (scripts/db.office.test.mjs fails if the two lists differ).
update public.business_accounts set market = 'atlanta'
 where market = 'greenville' and left(btrim(coalesce(address_zip, '')), 5) in
   ('30303','30308','30313','30309','30318','30312','30316','30305','30326','30327','30342','30328','30338','30346','30339','30322','30329','30030');
update public.business_orders set market = 'atlanta'
 where market = 'greenville' and left(btrim(coalesce(address_zip, '')), 5) in
   ('30303','30308','30313','30309','30318','30312','30316','30305','30326','30327','30342','30328','30338','30346','30339','30322','30329','30030');

-- ── the generator carries the door ────────────────────────────────────────────────────────────────
create or replace function public.generate_office_route(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; a record; ppg int; fallback_ppg int; win text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  -- the company-wide value stays as the safety net under every market lookup
  select coalesce(office_price_cents, 4500) into fallback_ppg from public.live_status where id = 1;
  fallback_ppg := coalesce(fallback_ppg, 4500);

  for a in
    select * from public.business_accounts
     where standing_active and standing_gallons is not null and standing_gallons >= 3
  loop
    -- price and window for THIS account's market; the singleton catches anything unseeded
    select coalesce(m.office_price_cents, fallback_ppg), coalesce(m.office_window, 'mon_0500_0800')
      into ppg, win
      from public.markets m
     where m.slug = coalesce(a.market, 'greenville');
    ppg := coalesce(ppg, fallback_ppg);
    win := coalesce(a.preferred_window, win, 'mon_0500_0800');

    if not exists (
      select 1 from public.business_orders
       where business_id = a.id and delivery_date = p_date and canceled_at is null
    ) then
      insert into public.business_orders (
        business_id, user_id, company, contact_name, contact_phone,
        address_street, address_city, address_zip, access_instructions, delivery_date, delivery_window,
        gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
        billing_terms, standing, market
      ) values (
        a.id, a.user_id, a.company, a.contact_name, a.contact_phone,
        coalesce(a.address_street, ''), coalesce(a.address_city, ''), coalesce(a.address_zip, ''), a.access_instructions,
        p_date, win,
        a.standing_gallons, ppg, (a.standing_gallons * ppg)::int, 0, 0, (a.standing_gallons * ppg)::int,
        a.billing_terms, true, coalesce(a.market, 'greenville')
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;


-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Standing office orders keep their access notes, and their city','fix','Delivery',
   'An office''s "suite 300, badge in at the front desk" was kept on its first order only, so every Monday order after it reached the door without the notes. The account keeps them now and every standing order carries them; accounts that had notes on an earlier order to the same address got them back. Office orders and accounts are also filed under the city their ZIP belongs to — they were all filed under Greenville, so an Atlanta office was priced and scheduled from Greenville''s terms.',
   '2026-10-04', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0346_an_office_keeps_its_city_and_its_door',
  'business_accounts.access_instructions (backfilled from each account''s latest order to the same street); generate_office_route restated from 0282 with access_instructions carried onto the order and nothing else; accounts and orders on Atlanta''s ZIP list moved off the greenville default.');

-- verify:
--   select count(*) from information_schema.columns where table_name = 'business_accounts' and column_name = 'access_instructions';   -- 1
--   select prosrc like '%a.access_instructions%' from pg_proc where proname = 'generate_office_route';                               -- t
--   select market, count(*) from public.business_accounts group by 1;                                                                 -- Atlanta ZIPs under atlanta
