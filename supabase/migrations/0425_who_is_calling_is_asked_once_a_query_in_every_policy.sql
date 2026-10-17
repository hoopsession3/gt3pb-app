-- ── 0425 — WHO IS CALLING IS ASKED ONCE A QUERY, IN EVERY POLICY ────────────────────────────────────────────────────
-- 2026-10-17. R19 of the 10/10 audit (database F3; Ryan, 2026-10-17: "Keep working to improve to a 10"). Paste into
-- Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. A row rule that asks who is calling — auth.uid(), is_admin(), is_staff() — asks the same question of every row a
-- query looks at, and gets the same answer each time; written bare, Postgres asks it once per row (a definer function
-- is never inlined: is_staff() reads profiles again for each one). 0422 wrapped the 126 "tenant isolation" policies; the
-- security snapshot at 0422 still counted 133 more that call one bare — the alerts, the orders, the profiles, the Pass's
-- reads among them (auth.uid() 59 times, is_admin() 76, is_staff() 42, effective_tenant() 2, auth.jwt() 2 — both inside
-- a larger sub-select, below). Wrapped in a sub-select, `(select auth.uid())`, the planner asks once a query (an
-- InitPlan: Supabase's auth_rls_initplan advice).
--
-- WHAT. Every policy in public is rewritten in place where it calls one of the helpers that take no argument —
-- auth.uid(), auth.jwt(), is_staff(), is_admin(), is_owner(), effective_tenant(), current_tenant() — bare. The new
-- expression is Postgres's own print of the policy (pg_get_expr), changed at those calls only: the same rule, the same
-- answer. A call already wrapped (`( SELECT auth.uid() AS uid)` in the print) is left as it is, so a second run finds
-- nothing to change. One inside a larger sub-select — 0281's `(select auth.jwt() ->> 'email')`, printed
-- `( SELECT (auth.jwt() ->> 'email'::text))` — is wrapped again (R19 review): the same answer, and a sub-select can be
-- the row's (`(select (auth.uid() = owner_id))` is asked once a row), which a pattern can't tell from one that isn't. market_visible(market) takes the row's market — wrapping it would change nothing — and stays.
-- A policy whose print has one of those names inside a quoted literal ('…is_admin()…') is left whole and named in the
-- notices: a pattern can't tell a literal from a call, and a rule's words are not this paste's to change.
--
-- set lock_timeout (database F16): each ALTER POLICY locks its table until the paste commits — a second or two for all of
-- them. If a long query is holding one, this stops after two seconds instead of queueing every order and every read
-- behind it; run it again a moment later. profiles goes last (R19 review): every caller helper reads it, so while its
-- lock is held every rule waits — for the last instant of the paste, not the whole of it. Paste it when service is quiet.
-- existing rows: none — policies only, the same rules in a different shape; nothing is written to a table but the
--   changelog, and no alert producer is restated.
-- changelog: below.

set lock_timeout = '2s';

-- The rewrite, as a function of this paste's session only (pg_temp goes when the session ends).
create or replace function pg_temp.asked_once(e text) returns text language sql immutable as $fn$
  select case when e is null then null else
    regexp_replace(
      regexp_replace(e, '(?<![[:alnum:]_.])(?<!SELECT )auth\.(uid|jwt)\(\)', '(select auth.\1())', 'g'),
      '(?<![[:alnum:]_.])(?<!SELECT )(public\.)?(is_staff|is_admin|is_owner|effective_tenant|current_tenant)\(\)', '(select public.\2())', 'g')
  end
$fn$;

do $$
declare r record; q text; c text; n integer := 0; skipped integer := 0; whole text;
  helper constant text := $re$(auth\.(uid|jwt)|is_staff|is_admin|is_owner|effective_tenant|current_tenant)\(\)$re$;
begin
  for r in
    select s.nspname as sch, t.relname as tbl, p.polname as pol,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
      from pg_policy p
      join pg_class t on t.oid = p.polrelid
      join pg_namespace s on s.oid = t.relnamespace
     where s.nspname = 'public'
     order by (t.relname = 'profiles'), t.relname, p.polname   -- profiles last (above)
  loop
    -- The same count with every quoted literal taken out ('…', '' inside one) is the count of calls; fewer means a
    -- helper's name sits inside a literal.
    whole := coalesce(r.qual, '') || ' ' || coalesce(r.chk, '');
    if regexp_count(whole, helper) <> regexp_count(regexp_replace(whole, $re$'(?:[^']|'')*'$re$, '', 'g'), helper) then
      raise notice '0425: % on %.% names a helper inside a quoted literal — left as it is', r.pol, r.sch, r.tbl;
      skipped := skipped + 1;
      continue;
    end if;
    q := pg_temp.asked_once(r.qual);
    c := pg_temp.asked_once(r.chk);
    continue when q is not distinct from r.qual and c is not distinct from r.chk;
    execute format('alter policy %I on %I.%I%s%s', r.pol, r.sch, r.tbl,
      case when q is not null then format(' using (%s)', q) else '' end,
      case when c is not null then format(' with check (%s)', c) else '' end);
    n := n + 1;
  end loop;
  raise notice '0425: % policies ask who is calling once a query; % left whole (a helper''s name in a literal)', n, skipped;
end $$;

drop function if exists pg_temp.asked_once(text);

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every list asks who you are once, not once a row', 'fix', 'System',
   'The rules that decide what each person may see now ask who is signed in once for each request instead of once for every row they look at — the same rules and the same answers, read faster as the business grows.',
   '2026-10-17', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers only):
--   select count(*) from pg_policy p join pg_class t on t.oid = p.polrelid join pg_namespace s on s.oid = t.relnamespace
--    where s.nspname = 'public' and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
--      ~ '(?<![[:alnum:]_.])(?<!SELECT )(auth\.(uid|jwt)|(public\.)?(is_staff|is_admin|is_owner|effective_tenant|current_tenant))\(\)';   -- 0
select public.record_migration('0425_who_is_calling_is_asked_once_a_query_in_every_policy');
reset lock_timeout;   -- the paste's own two seconds, not the next query's in this editor (the R19 review, third pass)
