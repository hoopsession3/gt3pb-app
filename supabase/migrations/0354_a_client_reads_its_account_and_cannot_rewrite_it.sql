-- 0354 — A CLIENT SEES ITS OWN OFFICE ACCOUNT, AND CANNOT REWRITE IT. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Phase 0 of the B2B challenge report (2026-10-07, "GT3 Challenge Report — B2B and Adaptive Layout").
-- Four live defects in the office accounts, one file. Nothing is dropped but one policy, and every
-- change to access here only narrows what a client can write or widens what a client can read OF
-- THEIR OWN.
--
-- 1. A SIGNED-IN CLIENT COULD REWRITE THEIR OWN ACCOUNT. 0187's "biz acct own" is FOR ALL with no
--    column limit, and authenticated holds insert and update on the table, so from the browser a
--    member could set billing_terms to net30, jug_balance to any number, standing_gallons anywhere
--    from 3 up (under the configured minimum), preferred_window to free text — and INSERT a net-30
--    account, which the crew's Generate (generate_office_route, security definer) then turned into
--    weekly orders, past every check /api/office makes (prepaid or net 15 only, the ZIP zone, a
--    phone). Now the client READS their account. The two things /office lets them change — the
--    weekly order on or off, and its gallons — go through set_office_standing(), which checks the
--    caller owns the account and holds the gallons to the minimum. Staff keep "biz acct staff", and
--    /api/office writes with the service role, as before.
--
-- 2. AN ATLANTA CLIENT COULD NOT SEE THEIR OWN ACCOUNT. 0291 ("an operator stops reading the other
--    city's money") put a RESTRICTIVE market scope on the money tables — six of them by 0293:
--    business_accounts, business_orders, account_activities, expenses, budgets, inventory_lots —
--    keyed on profiles.market, which is 'greenville' for every person unless someone changes it.
--    /api/office files an Atlanta office under 'atlanta' (0346), so its own client was scoped out of
--    it: /office showed "Bring GT3 to the office", and "invoice own read", whose subquery runs through
--    business_accounts' policies, hid their invoices too. The scope was written for staff. On those
--    six tables a member's permissive policies reach their own account and its orders and nothing
--    else, so market_visible() now passes a member and keeps scoping staff exactly as before. A
--    restrictive policy can only take access away, so this cannot open anything the permissive
--    policies did not already allow.
--
-- 3. THE PRICE A CLIENT IS QUOTED WAS NOT THE PRICE THEY WERE BILLED. Settings writes
--    live_status.office_price_cents; /office quotes it and a one-off booking charges it. The weekly
--    generator read markets.office_price_cents first — a copy 0282 seeded once and nothing has
--    written since — so a Settings change reached the quote and new bookings but never the standing
--    orders. The generator now prices from Settings, the number the client sees on /office. The
--    per-market column stays, unread, until per-market prices get a home in Settings; this file
--    reports any market whose copy had drifted from Settings, so the change is visible when applied.
--
-- 4. AN ERASED PERSON'S WEEKLY ORDER KEPT RUNNING. erase_account_data (0353) leaves the company's
--    account (rightly) and nulls its person — but left standing_active on, so every Generate made
--    another Monday order for nobody. A trigger now ends the standing order the moment an account
--    loses its person, whatever path did it, and tells the crew. An account that already has no
--    person is reported, not switched off: until 0353 nothing in the app took a person away, so one
--    without a person may be an office the crew set up by hand, and whether it runs is their call.
--
-- AND: a minimum under 3 gallons (Settings allowed 1) failed every booking at 0187's gallons >= 3
-- check. live_status now refuses a minimum under 3, and OfficeSettings refuses it too. live_status is
-- also the truck's live row — going live, the stop, the payment dials all rewrite it — and a check
-- holds on every write of a row, NOT VALID or not, so a minimum already under 3 is raised to 3 first
-- and reported: left as it was, the truck's next status change would have failed on it.
--
-- changelog: below.

-- ── 1 · the client reads their account; they write it only through a checked function ────────────
drop policy if exists "biz acct own" on public.business_accounts;
drop policy if exists "biz acct own read" on public.business_accounts;
create policy "biz acct own read" on public.business_accounts
  for select using (user_id = (select auth.uid()));

-- The two changes /office offers. Either argument may be null ("leave it"). The caller must be the
-- account's person; the gallons may not go under the larger of 3 (0187's check) and the minimum in
-- Settings. Returns the row as it now stands, so the page shows what was saved.
create or replace function public.set_office_standing(
  p_account uuid,
  p_active  boolean default null,
  p_gallons numeric default null
) returns public.business_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.business_accounts;
  floor_gal numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to change your office order.' using errcode = '28000';
  end if;
  select * into acct from public.business_accounts where id = p_account for update;
  if not found or acct.user_id is distinct from (select auth.uid()) then
    raise exception 'That is not your office account.' using errcode = '42501';
  end if;
  if p_gallons is not null then
    select greatest(3, coalesce(ls.office_min_gallons, 3)) into floor_gal from public.live_status ls where ls.id = 1;
    floor_gal := coalesce(floor_gal, 3);
    if p_gallons < floor_gal then
      raise exception 'The minimum is % gallons a week.', floor_gal using errcode = '22023';
    end if;
  end if;
  update public.business_accounts
     set standing_active  = coalesce(p_active, standing_active),
         standing_gallons = coalesce(p_gallons, standing_gallons),
         updated_at       = now()
   where id = p_account
  returning * into acct;
  return acct;
end $$;
revoke all on function public.set_office_standing(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_office_standing(uuid, boolean, numeric) to authenticated;

-- ── 2 · the market scope is for staff; a client always sees their own rows ───────────────────────
create or replace function public.market_visible(p_market text) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_market is null
      or auth.uid() is null                                  -- no session: the permissive policy decides
      or public.is_owner() or public.is_admin()              -- the whole company, unchanged
      or not public.is_staff()                               -- 0354: a client reads only their own rows anyway
      or coalesce((select market from public.profiles where id = auth.uid()), p_market) = p_market
$$;
grant execute on function public.market_visible(text) to authenticated, anon;
comment on function public.market_visible(text) is
  'True when the caller may read a row belonging to this market. Owners and admins see every city; other staff see their own; a client is not market-scoped (their permissive policies already limit them to their own rows — 0354). Used only inside RESTRICTIVE policies, so it can never grant access — only withhold it.';

-- ── 3 · the weekly orders are priced from Settings, the price /office quotes ─────────────────────
do $$
declare drift text;
begin
  select string_agg(m.slug || ' ' || m.office_price_cents || '¢', ', ' order by m.slug) into drift
    from public.markets m, public.live_status ls
   where ls.id = 1 and m.office_price_cents is not null and m.office_price_cents <> ls.office_price_cents;
  if drift is not null then
    raise notice '0354: standing orders in % were priced from a per-market copy that differs from Settings — they follow Settings from the next Generate', drift;
  end if;
end $$;

create or replace function public.generate_office_route(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; a record; ppg int; win text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  -- ONE PRICE (0354): Settings' price — the one /office quotes and a booking charges. 0282's
  -- per-market copy is no longer read here; nothing writes it.
  select coalesce(office_price_cents, 4500) into ppg from public.live_status where id = 1;
  ppg := coalesce(ppg, 4500);

  for a in
    select * from public.business_accounts
     where standing_active and standing_gallons is not null and standing_gallons >= 3
  loop
    -- the window for THIS account's market; the account's own window first, as 0346 had it
    select coalesce(m.office_window, 'mon_0500_0800') into win
      from public.markets m
     where m.slug = coalesce(a.market, 'greenville');
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

-- ── 4 · an account that loses its person stops its weekly order, and the crew hears ──────────────
create or replace function public.office_account_lost_person() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.user_id is not null and new.user_id is null and new.standing_active then
    new.standing_active := false;
    perform public.alert_open_once(
      'office_standing_orphaned', new.id, 'important', 'order',
      left('Weekly office order stopped: ' || coalesce(new.company, 'an office'), 180),
      'This office account no longer has a person on it (they deleted their GT3 account, or the account was cleared), so its weekly order was switched off. The company''s record, orders and invoices are kept. Reach the office another way if they still want deliveries.',
      '/crew?s=now');
  end if;
  return new;
end $$;
-- existing rows: office_account_lost_person — a new producer; it has never written an alert.
revoke all on function public.office_account_lost_person() from public, anon, authenticated;

drop trigger if exists office_account_lost_person_tg on public.business_accounts;
create trigger office_account_lost_person_tg
  before update of user_id on public.business_accounts
  for each row execute function public.office_account_lost_person();

-- An account that has no person before this file: named, and left as it is (note 4).
do $$
declare names text;
begin
  select string_agg(coalesce(company, id::text), ', ' order by company) into names
    from public.business_accounts where user_id is null and standing_active;
  if names is not null then
    raise notice '0354: weekly office orders still on for accounts with no person: % — left running; switch off any whose person deleted their account', names;
  end if;
end $$;

-- ── and: a minimum under 3 gallons can no longer be saved ────────────────────────────────────────
-- The value first, then the check: every later write of the truck's live row is held to the check,
-- so a minimum already under 3 would have failed the next go-live. Every booking failed on it anyway.
do $$
declare n int;
begin
  update public.live_status set office_min_gallons = 3 where office_min_gallons < 3;
  get diagnostics n = row_count;
  if n > 0 then
    raise notice '0354: the office minimum in Settings was under 3 gallons, which every booking failed on — it is 3 now';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_status_office_min_ok') then
    alter table public.live_status
      add constraint live_status_office_min_ok check (office_min_gallons >= 3) not valid;
  end if;
end $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Office clients see their own account, and only GT3 changes its terms','fix','Delivery',
   'An office client could change their own billing terms, jug count and delivery window from the browser, or create an account on net 30 that the weekly run then billed. Now a client sees their account and can switch the weekly order on or off and change its gallons (never under the minimum); everything else is GT3''s to set. Atlanta office clients could not see their own account, orders or invoices at all — the city filter meant for the crew hid them — and now they can. Weekly orders are priced from Settings, the same price /office shows, and an account whose person deletes their GT3 account stops its weekly order and tells the crew.',
   '2026-10-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select polname from pg_policy where polrelid = 'public.business_accounts'::regclass order by 1;   -- biz acct own read, biz acct staff, …
--   select has_function_privilege('anon', 'public.set_office_standing(uuid, boolean, numeric)', 'execute');   -- false
--   select prosrc like '%not public.is_staff()%' from pg_proc where proname = 'market_visible';               -- t
--   select prosrc not like '%m.office_price_cents%' from pg_proc where proname = 'generate_office_route';     -- t
--   select tgname from pg_trigger where tgname = 'office_account_lost_person_tg';                             -- 1 row
--   select string_agg(c.relname, ', ' order by c.relname) from pg_policy p join pg_class c on c.oid = p.polrelid
--    where p.polname = 'market scope';   -- the six in note 2: account_activities, budgets, business_accounts, business_orders, expenses, inventory_lots
select public.record_migration('0354_a_client_reads_its_account_and_cannot_rewrite_it',
  'business_accounts: "biz acct own" (FOR ALL) replaced by "biz acct own read"; set_office_standing(uuid, boolean, numeric) for the two client changes; market_visible passes non-staff; generate_office_route priced from live_status only; office_account_lost_person trigger (accounts already without a person reported, not changed); live_status office_min_gallons raised to 3 where under, then checked >= 3 (NOT VALID).');
