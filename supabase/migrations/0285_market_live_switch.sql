-- 0285 — EACH CITY OPENS ON ITS OWN DAY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Audit step E, and the last singleton standing between the two markets.
--
-- live_status is one row. is_live, preorder_lead_h and pay_at_pickup all live on it, so flipping the
-- truck live in Greenville flips Atlanta live too. 0279 fixed half of this — the "next stop" lookup
-- is market-filtered, so an Atlanta stop can no longer open Greenville's ordering window or print
-- its own name on a Greenville receipt. The other half is this: the LIVE FLAG itself is still shared.
--
-- The consequence is worse than a cosmetic one. Atlanta opens on corporate standing orders, weeks
-- before there is a consumer rig in the city. Under one shared flag, the day Greenville's truck goes
-- live, an Atlanta customer's app says the truck is live — with no stop, no rig and nobody to serve
-- them. "Stagger the launch days" is free once a market can carry its own switch, and impossible
-- until then.
--
-- WHAT THIS DOES. Same shape as 0282, because that shape is now proven: the three ordering flags
-- move onto the market as NULLABLE columns, and a view resolves market → singleton → hard default.
-- Null means "inherit", so on the day this runs every market resolves to exactly the singleton value
-- it reads today. Nothing changes until someone deliberately sets a market's own value.
--
-- Plus one thing the singleton could never express: opens_on. A market with a future opens_on is not
-- live no matter what its flag says. That is the stagger, stated once, in the place a launch date
-- belongs — rather than as a reminder to flip a switch on the right morning.
--
-- ZERO REGRESSION, and the reason is the coalesce chain: market → live_status → default. Greenville
-- keeps a null in all three columns, so all three resolve through to the singleton. The storefront
-- reads the same booleans it read yesterday.
--
-- Apply after 0284.

-- ── 1. Ordering flags belong to a market ─────────────────────────────────────────────────────────
-- Deliberately nullable with NO default. A default would mean "this market has decided", and none
-- of them has. Null is the honest value: inherit until told otherwise.
alter table public.markets add column if not exists is_live         boolean;
alter table public.markets add column if not exists preorder_lead_h int
  check (preorder_lead_h is null or preorder_lead_h between 0 and 72);
alter table public.markets add column if not exists pay_at_pickup   boolean;
alter table public.markets add column if not exists opens_on        date;

comment on column public.markets.is_live is
  'Null = inherit live_status. Set only when this market runs its own rig.';
comment on column public.markets.opens_on is
  'The day this market may go live at all. A future date holds the market closed regardless of is_live.';

-- Atlanta is not open yet and should not be able to go live by accident while a Greenville flag is
-- flipped. It gets an explicit hold; Greenville stays null and keeps inheriting exactly as before.
update public.markets set opens_on = date '2026-12-01'
 where slug = 'atlanta' and opens_on is null;

-- ── 2. One resolved answer per market ────────────────────────────────────────────────────────────
-- SECURITY DEFINER on purpose (no security_invoker): the storefront asks this question while logged
-- OUT, and markets carries a staff-only read policy. The view exposes only the ordering flags — the
-- office pricing columns 0282 put on the same table are deliberately not selected here.
create or replace view public.market_live as
select m.slug                                                    as market,
       (coalesce(m.is_live, ls.is_live, false)
         and (m.opens_on is null or m.opens_on <= current_date))  as is_live,
       coalesce(m.preorder_lead_h, ls.preorder_lead_h, 4)         as preorder_lead_h,
       coalesce(m.pay_at_pickup,   ls.pay_at_pickup,   true)      as pay_at_pickup,
       m.opens_on,
       (m.opens_on is not null and m.opens_on > current_date)     as pre_launch
  from public.markets m
  left join (select is_live, preorder_lead_h, pay_at_pickup
               from public.live_status where id = 1) ls on true;

revoke all on public.market_live from public;
grant select on public.market_live to anon, authenticated;

comment on view public.market_live is
  'Is this city taking orders right now. Resolves market → live_status singleton → default, so a market that has set nothing behaves exactly as it did before 0285.';

-- ── 3. Setters ───────────────────────────────────────────────────────────────────────────────────
-- Flipping live is an operating act — whoever is running the rig does it, so staff. Setting a launch
-- date is a company decision, so owner. Different gates because they are different decisions.
create or replace function public.set_market_live(p_market text, p_live boolean)
returns public.markets language plpgsql security definer set search_path = public as $$
declare m public.markets;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  select * into m from public.markets where slug = p_market;
  if not found then raise exception 'No such market: %', p_market; end if;
  if p_live and m.opens_on is not null and m.opens_on > current_date then
    raise exception 'That market opens on %. Move the opening date first if you mean to go live early.', m.opens_on;
  end if;

  update public.markets set is_live = p_live where slug = p_market returning * into m;
  return m;
end $$;
revoke all on function public.set_market_live(text, boolean) from public;
grant execute on function public.set_market_live(text, boolean) to authenticated;

create or replace function public.set_market_opens_on(p_market text, p_opens_on date)
returns public.markets language plpgsql security definer set search_path = public as $$
declare m public.markets;
begin
  if not public.is_owner() then raise exception 'Only an owner can set a market''s opening date.'; end if;
  update public.markets set opens_on = p_opens_on where slug = p_market returning * into m;
  if not found then raise exception 'No such market: %', p_market; end if;
  return m;
end $$;
revoke all on function public.set_market_opens_on(text, date) from public;
grant execute on function public.set_market_opens_on(text, date) to authenticated;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Each city opens on its own day','improvement','Today',
   'Whether the truck is live was a single company-wide switch, so the day Greenville went live the app would have told Atlanta customers the truck was live too — with no stop and nobody to serve them. Live status, the pre-order window and pay-at-pickup now belong to the city, and a city can carry an opening date that keeps it closed until the day it actually opens. Greenville''s behaviour is unchanged: it still reads the same company setting it always did.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- Greenville resolves to whatever the singleton says; Atlanta is held pre-launch:
--   select market, is_live, preorder_lead_h, pay_at_pickup, opens_on, pre_launch from public.market_live order by market;
--
--   -- and that Greenville row matches the singleton exactly (expect: true):
--   select (select is_live from public.market_live where market = 'greenville')
--        = (select is_live from public.live_status where id = 1) as unchanged;
--
--   -- going live early is refused while a future opening date stands: expect EXCEPTION
--   -- select public.set_market_live('atlanta', true);
