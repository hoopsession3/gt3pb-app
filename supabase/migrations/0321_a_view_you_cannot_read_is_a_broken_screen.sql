-- A VIEW YOU CANNOT READ IS A BROKEN SCREEN.
--
-- ── WHAT I BROKE, AND HOW ──────────────────────────────────────────────────────────────────────
-- 0320 shipped v_obligations and a Markets panel. Both went green through 745 assertions, a
-- production build, 71 UI smoke checks and five release gates, and BOTH WERE BROKEN THE MOMENT
-- THEY LOADED IN PRODUCTION. Found by opening the app, not by any test.
--
-- 0312 revoked twenty-one views from anon and authenticated, on a stated and correct premise:
--
--     "These are read by me in the SQL editor and by nothing else. Verified by grepping every
--      view name against app/, components/ and lib/ before writing this list."
--
-- That premise was true when it was written. Three of those views now have app consumers, because
-- I gave them consumers and did not restore the grants:
--
--   v_market_readiness          → components/MarketsPanel reads it directly
--   v_market_readiness_summary  → components/MarketsPanel reads it directly
--   v_compliance_freshness      → v_obligations selects FROM it
--
-- The third is the interesting one. Nothing in app/, components/ or lib/ mentions
-- v_compliance_freshness — a grep for what the app reads does not find it, and would not have
-- found it. It is a TRANSITIVE dependency: v_obligations is security_invoker, so the caller needs
-- SELECT on every relation underneath it, not just on the view it names. One missing grant three
-- levels down fails the entire read.
--
-- The audit that produced 0320 literally recorded "v_market_readiness has no UI consumers" as a
-- finding. 0312 revoked it BECAUSE it had no consumers. I resolved the finding and left the
-- revoke, which is a specific and avoidable kind of mistake: reading two facts about a thing and
-- acting on only one of them.
--
-- ── WHY THE TESTS COULD NOT CATCH IT ───────────────────────────────────────────────────────────
-- scripts/db.obligations.test.mjs creates its own v_compliance_freshness in a fixture, with no
-- grants at all, and runs every query as the PGlite superuser. A superuser has SELECT on
-- everything, so the fixture cannot express the failure. A fixture that answers differently from
-- production is a test that lies — this codebase has learned that four times now, and this is the
-- fifth: the fixture was not wrong about the SHAPE of the data, it was wrong about who was asking.
--
-- ── THE FIX, AND THE STANDING CHECK ────────────────────────────────────────────────────────────
-- Grant the three views back — but with security_invoker ON, which is 0312's other half and the
-- reason granting them is not a side door: the RLS on compliance_rules, markets, profiles and the
-- rest still decides what any given caller sees. This restores reach the app needs and no reach
-- the base tables would not already have given.
--
-- Then a view that makes this class of bug impossible to ship quietly again.

-- ── 1) the three that gained consumers ─────────────────────────────────────────────────────────
alter view public.v_compliance_freshness      set (security_invoker = on);
alter view public.v_market_readiness          set (security_invoker = on);
alter view public.v_market_readiness_summary  set (security_invoker = on);

grant select on public.v_compliance_freshness      to authenticated;
grant select on public.v_market_readiness          to authenticated;
grant select on public.v_market_readiness_summary  to authenticated;

comment on view public.v_compliance_freshness is
  'Permit and licence rules with how long since each was confirmed. No longer SQL-editor-only: v_obligations selects from it, so authenticated needs SELECT here or every obligations read fails. security_invoker keeps compliance_rules'' own RLS in charge.';
comment on view public.v_market_readiness is
  'Per-market launch checks. Read by the Markets panel in Settings since 2026-09-09 — 0312 revoked it when it had no consumers, which is no longer true.';

-- ── 2) the standing check ──────────────────────────────────────────────────────────────────────
-- Every security_invoker view the app can read, whose own dependencies it CANNOT read. That is the
-- exact shape of what broke here, including the transitive case a grep cannot see, and the only
-- acceptable answer is zero rows.
create or replace view public.v_invoker_view_gaps as
with granted as (
  select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and has_table_privilege('authenticated', c.oid, 'SELECT')
     -- definer views run as their owner, so their dependencies are the owner's problem, not the
     -- caller's. Only invoker views push the privilege requirement down to whoever asked.
     and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%'
)
select g.relname::text  as view_name,
       dep.relname::text as unreadable_dependency,
       dep.relkind::text as dependency_kind
  from granted g
  join pg_rewrite  r  on r.ev_class = g.oid
  join pg_depend   d  on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass
  join pg_class    dep on dep.oid = d.refobjid
  join pg_namespace dn on dn.oid = dep.relnamespace
 where dn.nspname = 'public'
   and dep.oid <> g.oid
   and dep.relkind in ('r', 'v', 'm')
   and not has_table_privilege('authenticated', dep.oid, 'SELECT')
 group by 1, 2, 3
 order by 1, 2;

alter view public.v_invoker_view_gaps set (security_invoker = on);
revoke all on public.v_invoker_view_gaps from public, anon, authenticated;

comment on view public.v_invoker_view_gaps is
  'Every security_invoker view authenticated can read whose own base relations it cannot. Empty is the only acceptable answer: one missing grant three levels down fails the whole read, and a grep over app code cannot see a transitive dependency. This is a diagnostic — SQL editor and service role only, deliberately not granted, which is the state that caused the bug it now detects.';

-- ── 3) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The overdue list and the Markets panel actually load now','fix','Command',
   'Both shipped yesterday and both failed the moment they opened: the database views they read had been closed to the app months earlier, back when nothing read them. Restored, with the row-level rules still in charge of who sees what — and there is now a standing check that refuses to let a screen ship pointing at data the app is not allowed to read, including the indirect case where the view you name is fine and something underneath it is not.',
   '2026-09-09', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0321_a_view_you_cannot_read_is_a_broken_screen',
  'Restores authenticated SELECT on v_compliance_freshness, v_market_readiness and v_market_readiness_summary — all three gained app consumers in 0320 while still carrying 0312''s revoke — with security_invoker on so RLS still governs. Adds v_invoker_view_gaps: every invoker view the app can read whose dependencies it cannot, including transitive ones a grep cannot find.');

-- verify:
--   select * from public.v_invoker_view_gaps;            -- expect ZERO rows, always
--   set local role authenticated; select count(*) from public.v_obligations;   -- expect a number
