-- 0301 — One report_spend, not two.
--
-- WHAT BROKE. 0292 gave report_spend a market parameter and wrote it as
--
--   create or replace function public.report_spend(p_month date default current_date,
--                                                  p_market text default null)
--
-- 'create or replace function' only replaces a function with the SAME signature. Two arguments is
-- not one, so it did not replace 0216's version — it created a second function beside it. Both take
-- zero REQUIRED arguments, so 'supabase.rpc("report_spend")', which is exactly how SpendBudget.tsx
-- calls it, matched both and Postgres refused to choose:
--
--   Could not choose the best candidate function between:
--     public.report_spend(p_month => date), public.report_spend(p_month => date, p_market => text)
--
-- The Spend & budget panel has been showing that sentence where the books should be, on every load,
-- since 0292 landed. Nobody reported it; it was found by opening the screen.
--
-- WHY THE TESTS MISSED IT. Every assertion I wrote called the function the new way — with both
-- arguments — which unambiguously selects the new one. The defect exists only on the call the APP
-- makes, and I never made that call. A fixture that doesn't match production is a test that lies;
-- so is a test that calls a function differently from the only caller that matters.
--
-- THE FIX is to drop the old one. 0292's version is a strict superset: p_market null means every
-- market, which is precisely what the one-argument version always did. No caller passes only a
-- date and means "one city", because until 0292 there were no cities.

drop function if exists public.report_spend(date);

-- ── the same mistake, as a query ───────────────────────────────────────────────────────────────
-- 'create or replace function' silently becomes 'create function' the moment an argument is added
-- or removed, and nothing warns you. Any two overloads whose [required..total] argument counts
-- overlap can both satisfy a single call, and Postgres will refuse that call rather than pick one.
-- This names them at the schema level, so the next one is found by a query and not by a screen.
create or replace view public.v_ambiguous_overloads as
with f as (
  select p.oid, p.proname,
         p.pronargs                     as total,
         p.pronargs - p.pronargdefaults as req,
         pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
)
select a.proname,
       a.sig as signature_a, a.req as min_args_a, a.total as max_args_a,
       b.sig as signature_b, b.req as min_args_b, b.total as max_args_b
  from f a
  join f b on a.proname = b.proname and a.oid < b.oid
 where a.req <= b.total and b.req <= a.total;

revoke all on public.v_ambiguous_overloads from public, anon;
grant select on public.v_ambiguous_overloads to authenticated;

comment on view public.v_ambiguous_overloads is
  'Public functions carrying two overloads that can both satisfy the same call. This should always be empty — a row here is a call the app is not able to make. report_spend sat here from 0292 until 0301 and broke Spend & budget for the whole stretch.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Spend & budget reads the books again','fix','Money',
   'Giving the spend report a city to filter by accidentally left the old cityless version of it in place beside the new one, and the app''s own call matched both — so instead of the books, the panel printed a database error about not being able to choose between them. The old one is gone. The report answers for one city or for all of them, which is what the old one always did. The schema now also carries a standing check for this exact shape of mistake, because nothing warns you when it happens.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_ambiguous_overloads;              -- expect zero rows
--   select jsonb_pretty(public.report_spend());              -- the call the app makes
--   select jsonb_pretty(public.report_spend(current_date, 'greenville'));
