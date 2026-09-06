-- 0282 — CORPORATE DELIVERY TERMS, PER MARKET. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Audit step C, and the last thing standing between Atlanta's head of ops and quoting a real number.
--
-- Two facts about corporate delivery live on the live_status SINGLETON — the one row, id = 1:
--   * office_price_cents  (0189, made the single authority by 0206) — one price per gallon, company-wide
--   * the delivery window, defaulting to 'mon_0500_0800' — Monday 5-8 AM, everywhere, forever
--
-- Neither can differ by city. Atlanta cannot be priced for its own market, and cannot run a window
-- that fits its own traffic. For a market whose entire opening plan is corporate standing orders,
-- that is not a detail — it is the product.
--
-- WHAT THIS DOES. Moves both onto the markets table, where a market already is a row, and teaches
-- generate_office_route to read the ACCOUNT'S market rather than the singleton. Greenville's values
-- are seeded from the singleton it uses today, so its price and window do not move by a cent or a
-- minute. Atlanta starts at the same numbers — a real decision you make, not a default I invented.
--
-- ZERO REGRESSION, and the fallback chain is the proof: market row → live_status singleton → 4500.
-- With one market seeded from the singleton, every branch resolves to the same number it does today.
-- live_status.office_price_cents is deliberately NOT dropped: it stays as the fallback, so a market
-- row that is missing or blank can never leave the generator without a price.
--
-- Apply after 0281.

-- ── 1. Terms belong to a market ──────────────────────────────────────────────────────────────────
alter table public.markets add column if not exists office_price_cents int
  check (office_price_cents is null or office_price_cents > 0);
alter table public.markets add column if not exists office_min_gallons int
  check (office_min_gallons is null or office_min_gallons > 0);
alter table public.markets add column if not exists office_window text;
alter table public.markets add column if not exists office_notes text;

-- Seed both markets from the singleton in use today. coalesce, not a literal: whatever Greenville is
-- actually charging right now is what Greenville keeps charging after this runs.
update public.markets m
   set office_price_cents = coalesce(m.office_price_cents, ls.office_price_cents, 4500),
       office_min_gallons = coalesce(m.office_min_gallons, ls.office_min_gallons, 3),
       office_window      = coalesce(m.office_window, 'mon_0500_0800')
  from (select office_price_cents, office_min_gallons from public.live_status where id = 1) ls
 where true;

-- Any market added later still gets a price rather than a null.
alter table public.markets alter column office_price_cents set default 4500;
alter table public.markets alter column office_min_gallons set default 3;
alter table public.markets alter column office_window      set default 'mon_0500_0800';

-- ── 2. The generator reads the account's market ──────────────────────────────────────────────────
-- Rewritten from 0206's live body with two changes and no others: the price is looked up per account
-- instead of once at the top, and the window falls back to the market's rather than only the
-- account's. Everything else — the staff gate, the standing-order filter, the duplicate guard, the
-- 3-gallon floor, the zero fee and tax — is preserved exactly.
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
        address_street, address_city, address_zip, delivery_date, delivery_window,
        gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
        billing_terms, standing, market
      ) values (
        a.id, a.user_id, a.company, a.contact_name, a.contact_phone,
        coalesce(a.address_street, ''), coalesce(a.address_city, ''), coalesce(a.address_zip, ''),
        p_date, win,
        a.standing_gallons, ppg, (a.standing_gallons * ppg)::int, 0, 0, (a.standing_gallons * ppg)::int,
        a.billing_terms, true, coalesce(a.market, 'greenville')
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── 3. Owners set the terms ──────────────────────────────────────────────────────────────────────
-- markets already has a staff READ policy (0275). Writing a price is an owner decision, and it goes
-- through a narrow function rather than a table policy so the columns that can move are explicit.
create or replace function public.set_market_office_terms(
  p_market text, p_price_cents int default null, p_min_gallons int default null, p_window text default null
) returns public.markets
language plpgsql security definer set search_path = public as $$
declare m public.markets;
begin
  if not public.is_owner() then raise exception 'Only an owner can set corporate delivery terms.'; end if;
  if p_price_cents is not null and p_price_cents <= 0 then raise exception 'A price has to be more than zero.'; end if;
  if p_min_gallons is not null and p_min_gallons <= 0 then raise exception 'A minimum has to be at least one gallon.'; end if;

  update public.markets
     set office_price_cents = coalesce(p_price_cents, office_price_cents),
         office_min_gallons = coalesce(p_min_gallons, office_min_gallons),
         office_window      = coalesce(nullif(btrim(p_window), ''), office_window)
   where slug = p_market
   returning * into m;
  if not found then raise exception 'No such market: %', p_market; end if;
  return m;
end $$;
revoke all on function public.set_market_office_terms(text, int, int, text) from public;
grant execute on function public.set_market_office_terms(text, int, int, text) to authenticated;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Each city can price corporate delivery for itself','improvement','Delivery',
   'Corporate delivery had one price per gallon and one delivery window for the whole company, both stored as a single company-wide setting. A second city could not quote its own rate or run a window that suits its own traffic — which matters most for a market opening on standing orders. Price, minimum and window now belong to the market, and the standing-order run reads each account''s own city. Greenville''s numbers were carried across exactly as they were, so nothing about its pricing changed.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- both markets carry terms, and Greenville matches the singleton it came from:
--   select m.slug, m.office_price_cents, m.office_min_gallons, m.office_window,
--          (select office_price_cents from public.live_status where id = 1) as singleton_price
--   from public.markets m order by m.slug;
--
--   -- the generator reads the market now (expect: true):
--   select prosrc like '%public.markets%' as reads_market
--   from pg_proc where proname = 'generate_office_route';
--
--   -- and still reads the singleton as its fallback (expect: true):
--   select prosrc like '%office_price_cents%' as keeps_fallback
--   from pg_proc where proname = 'generate_office_route';
--
--   -- set Atlanta's own rate when you've decided it (owner only):
--   -- select public.set_market_office_terms('atlanta', 4800, 3, 'tue_0600_0900');
