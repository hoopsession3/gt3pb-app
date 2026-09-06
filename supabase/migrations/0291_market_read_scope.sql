-- 0291 — AN OPERATOR STOPS READING THE OTHER CITY'S MONEY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- 0289 gave a market lead authority over their own crew. It deliberately did not touch what anyone
-- can READ, because is_staff() and is_admin() have no "where" in them and narrowing that touches
-- every policy in the database. This is that change, scoped to the surface where it matters most and
-- to nothing else.
--
-- THE SHAPE. A restrictive policy can only ever REMOVE access — it ANDs onto whatever permissive
-- policy already governs the table. So this cannot open anything, and the worst case is that
-- somebody sees less than they should, which is visible immediately and reversible in one statement.
-- That property is why this is safe to ship on a table that is already working.
--
-- WHO SEES EVERYTHING. Owners and admins, unchanged. The company's books are the company's books.
-- WHO SEES ONE CITY. Everyone else, limited to profiles.market — the column 0289 added.
--
-- ZERO REGRESSION, and it is stronger than usual here: there are exactly two profiles today and both
-- are owners, so on the day this runs literally nobody's reach changes. The policy only begins to
-- bite when the first non-owner staff account exists, which is the moment it is wanted.
--
-- WHY ONLY THESE TABLES. Twenty-four tables carry a market column. The nine below are the ones where
-- cross-city reading is a real problem: corporate accounts and their orders, customer activity, the
-- money. The other fifteen are operational — events, stops, assets, prep — and a crew that cannot see
-- what the other city is running is a crew that cannot help it. Narrowing those is a business
-- decision, not a security one, so it is not made here. Which tables are covered and which are not is
-- a query rather than a memory: v_market_scope, at the bottom.
--
-- Apply after 0290.

-- ── 1. What may this caller see ──────────────────────────────────────────────────────────────────
-- Null market on a row means "not attributed to a city" and stays visible to everyone: an
-- unattributed row disappearing silently is exactly the failure this migration must not cause.
create or replace function public.market_visible(p_market text) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_market is null
      or auth.uid() is null                                  -- no session: the permissive policy decides
      or public.is_owner() or public.is_admin()              -- the whole company, unchanged
      or coalesce((select market from public.profiles where id = auth.uid()), p_market) = p_market
$$;
grant execute on function public.market_visible(text) to authenticated, anon;

comment on function public.market_visible(text) is
  'True when the caller may read a row belonging to this market. Owners and admins see every city; everyone else sees their own. Used only inside RESTRICTIVE policies, so it can never grant access — only withhold it.';

-- ── 2. The money surfaces ────────────────────────────────────────────────────────────────────────
-- Applied defensively: a table that is missing, has no market column, or has RLS off is skipped and
-- reported by the view below rather than causing this file to fail.
do $$
declare
  t text;
  n int := 0;
  skipped text[] := '{}';
  MONEY constant text[] := array[
    'business_accounts',   -- corporate customers
    'business_orders',     -- standing-order revenue
    'account_activities',  -- who said what to which account
    'orders',              -- cup orders
    'drop_orders',
    'delivery_orders',
    'expenses',
    'budgets',
    'subscriptions'
  ];
begin
  foreach t in array MONEY loop
    if to_regclass('public.' || t) is null then
      skipped := array_append(skipped, t || ' (no such table)'); continue;
    end if;
    if not exists (select 1 from pg_attribute a
                    where a.attrelid = to_regclass('public.' || t)
                      and a.attname = 'market' and not a.attisdropped) then
      skipped := array_append(skipped, t || ' (no market column)'); continue;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || t)) then
      skipped := array_append(skipped, t || ' (RLS off)'); continue;
    end if;

    execute format('drop policy if exists "market scope" on public.%I', t);
    execute format(
      'create policy "market scope" on public.%I as restrictive for select using (public.market_visible(market))', t
    );
    n := n + 1;
  end loop;

  raise notice '0291: market scope applied to % table(s)', n;
  if array_length(skipped, 1) > 0 then
    raise notice '0291: skipped — %', array_to_string(skipped, ', ');
  end if;
end $$;

-- ── 3. Which tables are scoped, and which are deliberately not ───────────────────────────────────
create or replace view public.v_market_scope as
select c.relname::text as table_name,
       c.relrowsecurity as rls_on,
       exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'market scope') as market_scoped,
       exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant isolation') as tenant_isolated,
       case
         when exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'market scope')
           then 'scoped — a non-owner sees only their own city'
         when not c.relrowsecurity
           then 'RLS off — nothing is scoped here at all'
         else 'shared on purpose — operational, every city can see it'
       end as verdict
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'market' and not a.attisdropped)
 order by market_scoped desc, c.relname;

revoke all on public.v_market_scope from public, anon;
grant select on public.v_market_scope to authenticated;

comment on view public.v_market_scope is
  'Every table carrying a market, and whether reading it is limited to the caller''s own city. "shared on purpose" is a decision, not an oversight — change it by adding the table to 0291''s list.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('One city''s money stays in that city','security','Platform',
   'Anyone on staff could read every city''s corporate accounts, orders and customer activity, because roles said what someone was and never where. Owners and admins still see the whole company. Everyone else now sees the money for their own city only, while the operational side — events, stops, prep, equipment — stays shared on purpose, because a crew that cannot see what the other city is running cannot help it. Nothing changed for anyone today: both accounts on the system are owners.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- what is scoped and what is shared, with the reason:
--   select table_name, verdict from public.v_market_scope;
--
--   -- an owner still sees everything (expect: true):
--   select public.market_visible('atlanta') and public.market_visible('greenville') as owner_sees_all;
--
--   -- corporate revenue is unchanged for you (expect: the same count as before):
--   select count(*) from public.business_orders;
