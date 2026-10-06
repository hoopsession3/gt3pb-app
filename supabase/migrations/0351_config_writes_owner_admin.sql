-- ── WHAT ONLY AN OWNER OR ADMIN SEES, ONLY AN OWNER OR ADMIN CAN CHANGE ────────────────────────
-- 2026-10-06. From an audit of what the database lets each role write, held against what the
-- screens show each role.
--
-- Five writes were gated on is_staff(), and is_staff() (0031, 0035) means "any role but member":
-- server, contractor, operator and event manager all pass it. Every one of the five is set from a
-- screen only an owner or an admin can open — the console's Customers, Money and Settings sections
-- are theirs alone (components/OperatorNav.tsx, ROLE_SECTIONS), and the Markets panel shows its
-- live switch to the owner and nobody else. The screens said "owner or admin"; the database said
-- "anyone on the crew". A server signed in to the app could have done from outside it what no
-- screen offers her:
--
--   member_benefits      "benefits staff write"   (0176)   mint a code for anything off, or a perk
--   subscription_plans   "sub_plans staff write"  (0048)   reprice a membership plan, or switch it off
--   products             "products staff write"   (0062)   reprice the menu, or take a drink off it
--   broadcasts           "broadcast staff write"  (0196)   put a message in front of every customer
--   set_market_live      is_staff()               (0285)   put a city live, or take it dark
--
-- 1. CODES AND PERKS, PLANS, BROADCASTS. Each staff write policy becomes an admin write policy —
--    is_admin(), owner or admin (0035) — and nothing else moves. Every read policy stays exactly as
--    it is, so the crew still READ all of it (a perk on a customer's card, the plan a subscriber is
--    on, the broadcast going out), and so does every restrictive tenant isolation policy.
--
-- 2. PRODUCTS, AND THE ONE THING CREW DO CHANGE. Crew 86 an item — from the 86 board in service
--    mode (components/EightySix.tsx) and from the menu list (components/MenuManager.tsx), both of
--    which send { sold_out } and nothing else. So a product is not simply admin-only:
--      insert, delete   owner or admin
--      update           anyone on the crew may reach the row, so the 86 keeps working, and a
--                       trigger refuses a non-admin change to any column but sold_out, sold_out_at
--                       and updated_at.
--    Why a trigger and not a column grant: Postgres grants columns to database roles, and every
--    person signed in to the app is the same role — authenticated, owner and server alike. A policy
--    decides which ROWS; nothing in row level security decides which columns. The trigger compares
--    the whole row less the three columns crew may touch, so a column added next month is covered
--    without anyone remembering to list it.
--
--    WHO IT STOPS: a person (auth.uid() set) who is not an owner or admin. WHO IT DOES NOT: a write
--    with nobody behind it — the service role's server routes, pg_cron's 4am reset of the 86s
--    (0130), a migration, the SQL editor. That is 0076's rule, for 0076's reason: a real API caller
--    always has auth.uid(), and only the internal paths do not.
--
--    It fires before products_stamp_86 and products_touch (a table's triggers fire in name order),
--    so it judges exactly what the person sent; sold_out_by, and the stamped sold_out_at and
--    updated_at, are written after it by the database. Crew cannot write sold_out_by themselves:
--    who 86'd an item is stamped, never claimed.
--
-- 3. A CITY GOES LIVE ON THE OWNER'S WORD. 0285 reasoned that flipping live is an operating act,
--    so staff. The screen never agreed: MarketsPanel shows "Put Atlanta live" to the owner alone,
--    and tells everyone else that going live is an owner decision. The database now says what the
--    screen says. The function is 0285's, verbatim, with one line added at the top — the same
--    signature, security definer, search_path and grants.
--
-- What this does not touch: who can READ anything; the tenant isolation policies; the service
-- role; the truck's own live switch (live_status, "admin write live" since 0003 — a different
-- switch from a city's); and the 86, which every crew role keeps.

-- ── 1) codes and perks, plans, broadcasts: owner or admin writes ───────────────────────────────
drop policy if exists "benefits staff write" on public.member_benefits;
drop policy if exists "benefits admin write" on public.member_benefits;
create policy "benefits admin write" on public.member_benefits for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "sub_plans staff write" on public.subscription_plans;
drop policy if exists "sub_plans admin write" on public.subscription_plans;
create policy "sub_plans admin write" on public.subscription_plans for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "broadcast staff write" on public.broadcasts;
drop policy if exists "broadcast admin write" on public.broadcasts;
create policy "broadcast admin write" on public.broadcasts for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 2) products: owner or admin makes and removes them; the crew may 86 one ────────────────────
drop policy if exists "products staff write" on public.products;

drop policy if exists "products admin insert" on public.products;
create policy "products admin insert" on public.products for insert to authenticated
  with check ((select public.is_admin()));

-- The crew's door to a product row. The trigger below decides what may change once through it.
drop policy if exists "products staff update" on public.products;
create policy "products staff update" on public.products for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy if exists "products admin delete" on public.products;
create policy "products admin delete" on public.products for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.product_crew_86_only() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  crew_may constant text[] := array['sold_out', 'sold_out_at', 'updated_at'];
  n jsonb;
  o jsonb;
  changed text;
begin
  -- Nobody behind the write: the service role, cron, a migration, the SQL editor (0076's rule).
  if auth.uid() is null then return new; end if;

  n := to_jsonb(new) - crew_may;
  o := to_jsonb(old) - crew_may;
  if n = o then return new; end if;            -- an 86, or a save that changed nothing else
  if public.is_admin() then return new; end if;

  select string_agg(k, ', ' order by k) into changed
    from jsonb_object_keys(n) as k
   where n -> k is distinct from o -> k;
  raise exception using
    message = 'Only an owner or admin can change a product — crew can 86 it.',
    detail  = 'Crew can mark a product sold out or back on, and nothing else. This change also touched: ' || changed || '.';
end $$;
-- A trigger's function, and nothing else's: it runs as its owner, and no role calls it directly.
revoke all on function public.product_crew_86_only() from public, anon, authenticated;

comment on function public.product_crew_86_only() is
  'A person who is not an owner or admin may change a product''s sold_out, sold_out_at and updated_at, and nothing else (0351). Writes with no auth.uid() — service role, cron, migrations, the SQL editor — pass.';

drop trigger if exists products_crew_86_only on public.products;
create trigger products_crew_86_only before update on public.products
  for each row execute function public.product_crew_86_only();

-- ── 3) a city goes live on the owner's word ────────────────────────────────────────────────────
-- 0285's function, verbatim but for the first line of the body.
create or replace function public.set_market_live(p_market text, p_live boolean)
returns public.markets language plpgsql security definer set search_path = public as $$
declare m public.markets;
begin
  if not public.is_owner() then raise exception 'Only an owner can put a city live or take it offline.'; end if;
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

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Only owners and admins can change codes, plans, products and broadcasts','security','Crew',
   'Discount codes, founding perks, membership plans, the menu''s products and broadcasts have only ever been on owner and admin screens, but the database behind them would have taken a change to any of them from anyone on the crew who went around the screen. Now it takes those changes only from an owner or an admin. Crew can still 86 an item and bring it back on, from the 86 board or the menu — that is the one thing about a product they can change. And only an owner can put a city live or take it offline, which is what the Markets panel has always shown.',
   '2026-10-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('member_benefits','subscription_plans','broadcasts','products') order by 1, 2;
--                                       -- no "staff write" left; "… admin write", "products staff update"
--   select tgname from pg_trigger where tgrelid = 'public.products'::regclass and not tgisinternal order by 1;
--                                       -- products_crew_86_only sorts before products_stamp_86, products_touch
--   select public.set_market_live('greenville', true);   -- as anyone but an owner: 'Only an owner can …'
select public.record_migration('0351_config_writes_owner_admin');
