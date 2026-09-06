-- 0283 — THE EIGHT TABLES TENANT ISOLATION NEVER REACHED. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Audit step F, run against production rather than read off a file — and it found something.
--
-- 0134 walked every table carrying tenant_id and gave each one two things: a stamp_tenant_tg trigger
-- so new rows get a tenant, and a RESTRICTIVE "tenant isolation" policy so nobody reads across
-- tenants. It was written as a dynamic loop precisely so re-running it would pick up tables added
-- later. It was never re-run. So every table created after 0134 got the trigger (later migrations
-- copied that line) and none got the policy.
--
-- Eight tables, confirmed against production 2026-09-06 — all with RLS on, two permissive policies
-- each, and zero restrictive ones:
--
--   primal_lesson_products   primal_lessons   primal_modules   primal_pillars
--   primal_progress          program_access   shop_orders      shop_products
--
-- shop_orders is the one that matters most: it is a customer order table with a tenant_id that
-- nothing enforced. Today there is exactly one tenant, so nothing has leaked and nothing could have.
-- The day a second tenant exists, these eight are where it would leak first.
--
-- ZERO REGRESSION, and the row counts are the proof. Every one of these tables was checked before
-- this file was written: 0 null tenant_ids, and at most 1 distinct tenant_id present. The policy
-- reads tenant_id = effective_tenant(), which resolves to the founding tenant for anon and for every
-- current sign-in — so every existing row stays visible to exactly who can see it today, including
-- the 506 shop_products rows the storefront serves to logged-out visitors.
--
-- Two things beyond the fix, so this cannot quietly happen a third time:
--   * the loop ADDS what is missing instead of dropping and recreating 97 working policies
--   * a view, v_tenant_isolation_gaps, that answers "which tables are unprotected" in one query
--     instead of the four-query check that had to be reconstructed by hand to find this
--
-- Apply after 0282.

-- ── 1. No row may be invisible to itself ─────────────────────────────────────────────────────────
-- A restrictive policy compares tenant_id to the caller's tenant, so a NULL tenant_id would vanish
-- behind it. Production has none. This runs anyway, because the loop below is dynamic and the next
-- table it picks up is one nobody has checked by hand.
do $$
declare r record; fixed int; total int := 0;
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  loop
    execute format(
      'update public.%I set tenant_id = %L where tenant_id is null',
      r.tbl, '00000000-0000-0000-0000-000000000001'
    );
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice '0283: adopted % orphan row(s) on public.% into the founding tenant', fixed, r.tbl;
    end if;
  end loop;
  raise notice '0283: % orphan row(s) adopted in total', total;
end $$;

-- ── 2. Give the missing tables what 0134 gave the rest ───────────────────────────────────────────
-- Same trigger, same policy text, character for character. The difference from 0134 is that this
-- only touches what is ACTUALLY missing: a table that already has a working policy is not dropped
-- and rebuilt, so a re-run of this file is genuinely a no-op rather than 97 silent recreations.
do $$
declare r record; n_trg int := 0; n_pol int := 0;
begin
  for r in
    select c.oid, c.relname as tbl, c.relrowsecurity as rls_on
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  loop
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = r.oid and t.tgname = 'stamp_tenant_tg') then
      execute format(
        'create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()',
        r.tbl
      );
      n_trg := n_trg + 1;
      raise notice '0283: stamping trigger added to public.%', r.tbl;
    end if;

    -- The policy only goes on tables where RLS is already enforced. 0134 made that choice
    -- deliberately: turning RLS ON here would take a public surface dark without anyone asking.
    if r.rls_on and not exists (select 1 from pg_policy p
                                 where p.polrelid = r.oid and p.polname = 'tenant isolation') then
      execute format(
        'create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())',
        r.tbl
      );
      n_pol := n_pol + 1;
      raise notice '0283: tenant isolation policy added to public.%', r.tbl;
    end if;
  end loop;
  raise notice '0283: % trigger(s), % policy(ies) added', n_trg, n_pol;
end $$;

-- ── 3. The gap becomes a query, not an investigation ─────────────────────────────────────────────
-- This is the artefact that matters after today. Finding the eight took four hand-written catalog
-- queries and a diff. Finding the ninth should take one select.
create or replace view public.v_tenant_isolation_gaps as
select c.relname::text as table_name,
       c.relrowsecurity  as rls_on,
       exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'stamp_tenant_tg') as stamped,
       exists (select 1 from pg_policy  p where p.polrelid = c.oid and p.polname = 'tenant isolation') as isolated,
       case
         when not c.relrowsecurity then 'rls off — decide before tenant #2'
         when not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant isolation')
           then 'UNPROTECTED — carries tenant_id, RLS on, no isolation policy'
         when not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'stamp_tenant_tg')
           then 'no stamping trigger — inserts may land without a tenant'
         else 'ok'
       end as verdict
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'
   and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped);

revoke all on public.v_tenant_isolation_gaps from public, anon;
grant select on public.v_tenant_isolation_gaps to authenticated;

comment on view public.v_tenant_isolation_gaps is
  'Every table carrying tenant_id, and whether tenant isolation actually reaches it. verdict <> ''ok'' is a finding. Added by 0283 after eight tables were found unprotected.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Customer data is now walled off on every table','security','Platform',
   'The rule that keeps one company''s data from being visible to another was applied across the database a while back, and it was written to pick up new tables automatically — but it was never re-run, so eight tables built since then were never covered. Shop orders was one of them. Nothing was ever exposed, because there is only one company on the system today, but the protection is now in place everywhere it belongs, and there is a single check that will show immediately if a future table is ever missed.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the whole audit in one line now. expect: NO ROWS.
--   select * from public.v_tenant_isolation_gaps where verdict <> 'ok' order by table_name;
--
--   -- the eight are covered, and the count moved 97 → 105:
--   select count(*) from pg_policy where polname = 'tenant isolation';
--
--   -- and the storefront still serves every product to a logged-out visitor:
--   select count(*) from public.shop_products;                                            -- 506
