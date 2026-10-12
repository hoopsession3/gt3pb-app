-- ── 0382 — MERCH, RECIPES AND LESSONS ARE WRITTEN BY OWNERS AND ADMINS ────────────────────────────────────────────
-- 2026-10-12. Found by the Today, Command, Audit & Catalog audit, and confirmed in production's security snapshot
-- (supabase/schema.security.json, pulled at ledger 0380; the owner approved building this on 2026-10-12).
--
-- WHY. When the Catalog became a section of its own (0352), its header said the panels in it "write what they wrote
-- before, under the policies they had (0351: owner or admin)". Three of them never had such a policy. Every one of
-- these lets ANY staff role write, through the API, with the app's public key and their own sign-in:
--   · shop_products       "shop products staff write"   (0271:110-112)  — merch: titles, prices, costs, what is published
--   · product_components  "pc staff write"              (0062:59-61)   — a drink's recipe, which costs every serving
--   · primal_lessons      "primal lessons write"        (0272:167-169)  — the lessons members pay to take
-- So a server or an event manager could reprice a shirt, change what a serving of RISE costs or rewrite a lesson,
-- without opening a screen that offers it. The screens that do (components/MerchManager, MenuManager's recipe rows,
-- LessonsManager) are in the Catalog, which only owners and admins open (components/OperatorNav ROLE_SECTIONS).
--
-- WHAT. Each of the three write policies is replaced by one that admits owners and admins only (public.is_admin():
-- role owner or admin, or the is_admin flag — the same test 0351 uses for products). Untouched:
--   · every read policy (the shop's public read, the crew's recipe read, members' lessons);
--   · the "tenant isolation" restrictive policy on each table, which still applies on top;
--   · the server's own writes (app/api/apliiq/*), which use the service role and are not subject to these policies;
--   · the 86. It is products.sold_out, written under 0351's rule (any crew role may change sold-out and nothing else),
--     on a table this migration does not touch.
-- A second run changes nothing.
-- changelog: none — nobody's screen changes; a door the screens never offered is closed.

drop policy if exists "shop products staff write" on public.shop_products;
drop policy if exists "shop products admin write" on public.shop_products;
create policy "shop products admin write" on public.shop_products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "pc staff write" on public.product_components;
drop policy if exists "pc admin write" on public.product_components;
create policy "pc admin write" on public.product_components for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "primal lessons write" on public.primal_lessons;
drop policy if exists "primal lessons admin write" on public.primal_lessons;
create policy "primal lessons admin write" on public.primal_lessons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- verify (names and booleans only):
--   select policyname from pg_policies where tablename in ('shop_products','product_components','primal_lessons')
--    order by tablename, policyname;   -- the three "… admin write" names; no "staff write", no "primal lessons write"
--   select count(*) from pg_policies where tablename in ('shop_products','product_components','primal_lessons')
--      and qual like '%is_staff%' and cmd = 'ALL';                                              -- 0
select public.record_migration('0382_merch_recipes_and_lessons_are_written_by_owners_and_admins');
