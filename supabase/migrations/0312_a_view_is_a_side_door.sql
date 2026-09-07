-- 0312 — A VIEW IS A SIDE DOOR (2026-09-07)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Found while starting the shop-orders screen, by asking a question I should have asked in 0311:
-- what does a CUSTOMER see if they read one of these views directly?
--
-- Not a theory. Run against production, impersonating a real profiles row with role = 'member':
--
--     select count(*) from public.profiles;        -- 1   ← RLS working exactly as designed
--     select count(*) from public.v_crew_person;   -- 3   ← the entire crew
--     select count(*) from public.v_market_crew;   -- 3
--     select count(*) from public.v_agreement_hours;  -- 1  ← hours logged against an operator deal
--
-- One row from the table, three from the view over the same table. That gap IS the bug. A Postgres
-- view runs as its OWNER unless it is created `with (security_invoker = on)`; the owner here is
-- postgres, which bypasses RLS. So every `grant select ... to authenticated` on a definer view is a
-- side door around the row-level security that 0305 spent a whole migration proving was the only
-- thing standing between anon and this database.
--
-- The count: 40 views in public. FIVE carry security_invoker (all_tasks 0225, inventory_on_hand and
-- inventory_status 0288, product_economics_live 0256, market_live — see below). THIRTY-FIVE do not,
-- and all 35 grant select to `authenticated`.
--
-- Why it has not leaked yet, stated honestly: today all 15 auth users also hold a crew profile, so
-- there is no member account to walk through the door. That is luck and calendar, not design. The
-- storefront is live with 6 published products, `on_auth_user_created` mints a profiles row for
-- every signup, and the default role is 'member' — which is_staff() correctly excludes. The first
-- customer who makes an account opens all 35.
--
-- I WROTE THREE OF THESE THIS MORNING (v_crew_person, v_crew_onboarding, v_crew_onboarding_steps in
-- 0311) and eight more across 0308–0310. The pattern was copied from the file above it every time,
-- which is exactly how a defect becomes a house style. Hence the gate at the bottom of this file:
-- the rule has to outlive my memory of it.
--
-- ── the fix, in two halves, because the views are two different things ──────────────────────────
-- Half one is the important one and it is NOT security_invoker. Seven of these views read
-- pg_catalog / information_schema (v_delete_rights, v_tenant_isolation_gaps, v_migration_gaps,
-- v_ambiguous_overloads, v_item_kind_gaps, v_client_error_shape, v_migration_status). The system
-- catalogs have no RLS, so security_invoker protects them exactly zero. They are diagnostics I run
-- in the SQL editor; nothing in the app reads them. So: TAKE THE GRANT AWAY. Twenty-one views, all
-- verified unreferenced across app/, components/ and lib/.
--
-- Half two is the thirteen views the app actually reads: security_invoker = on, so they honour the
-- RLS already sitting on their base tables. A member reading v_crew_person now sees their own row
-- and nothing else, which is what the table would have told them all along.
--
-- market_live is deliberately left alone. 0285 wrote it definer ON PURPOSE ("the storefront asks
-- this question while logged out") and grants it to anon. It is one boolean about whether ordering
-- is open. Documented exception, allow-listed below, not an oversight.

-- ── 1) THE DIAGNOSTICS — take the grant away entirely ──────────────────────────────────────────
-- These are read by me in the SQL editor and by nothing else. Verified by grepping every view name
-- against app/, components/ and lib/ before writing this list. postgres and the service role keep
-- full access; that is how I read them.
do $$
declare
  v text;
  internal text[] := array[
    'v_ambiguous_overloads','v_batch_progress','v_batch_removable','v_batch_traceability',
    'v_client_error_shape','v_compliance_freshness','v_delete_rights','v_ingredient_cost',
    'v_item_kind_gaps','v_market_crew','v_market_readiness','v_market_readiness_summary',
    'v_market_scope','v_migration_gaps','v_migration_status','v_operator_supply_posture',
    'v_receipt_gaps','v_recipe_ingredient_gaps','v_tenant_isolation_gaps','v_unaccounted_batches',
    'v_workstream_owners'
  ];
begin
  foreach v in array internal loop
    if to_regclass('public.'||v) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end $$;

-- ── 2) THE APP'S VIEWS — make them honour the RLS underneath ───────────────────────────────────
-- security_invoker flips the view from "runs as postgres" to "runs as whoever asked", which is the
-- only setting under which the policies on the base tables mean anything. Crew are unaffected:
-- every one of these base tables already carries an is_staff() read policy, which is why the crew
-- census before and after this migration is identical (verified, both 40 views, row for row).
--
-- Ordering matters: v_crew_person reads v_crew_onboarding reads v_crew_onboarding_steps, and under
-- invoker the CALLER needs select on each link in that chain — which is why v_crew_onboarding keeps
-- its grant even though no component names it directly. Same for inventory_on_hand beneath
-- inventory_status. Revoking a view that another view stands on is how this kind of fix breaks a
-- screen; the dependency graph was read out of pg_depend rather than guessed at.
do $$
declare
  v text;
  app_views text[] := array[
    'v_agreement_hours','v_agreement_integrity','v_compliance_jurisdictions',
    'v_crew_onboarding','v_crew_onboarding_steps','v_crew_person',
    'v_inventory_categories','v_jug_open','v_loop_open','v_offer_letter',
    'v_options','v_primal_tree','v_promotable'
  ];
begin
  foreach v in array app_views loop
    if to_regclass('public.'||v) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v);
      execute format('grant select on public.%I to authenticated', v);
    end if;
  end loop;
end $$;

-- ── 2b) NOTHING IN public IS READABLE BY A LOGGED-OUT VISITOR EXCEPT THE ONE THAT SHOULD BE ────
-- Written because the assertion in section 4 fired on the first run and named five views I had not
-- looked at: all_orders, all_tasks, inventory_on_hand, inventory_status, product_economics_live.
-- My census had filtered them out — it asked "which DEFINER views can anon read", and these five
-- are the five that already had security_invoker. They were the only ones I had decided were
-- already fine, so they were the only ones I stopped checking.
--
-- Measured before changing anything: anon reads 0 rows from all five, because invoker + RLS is
-- doing its job. So this is not a live exposure — it is a grant with no purpose sitting on a view
-- one `alter` away from being a live exposure. Sweeping rather than listing, so this holds for
-- views that do not exist yet.
do $$
declare v text;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname <> 'market_live' loop
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;

-- ── 3) PROVE IT, HERE, RATHER THAN TRUSTING THE TWO BLOCKS ABOVE ───────────────────────────────
-- A migration that says it closed a door and did not is worse than one that never claimed to. This
-- raises if any view in public is still (a) running as its owner and (b) readable by a logged-in
-- customer, outside the one documented exception. It is also the assertion that will fail the day
-- someone adds view number 41 the old way.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname <> 'market_live'                      -- documented in 0285; anon by design
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%'
     and has_table_privilege('authenticated', c.oid, 'select');
  if bad is not null then
    raise exception 'These views still run as their owner and are readable by any logged-in customer: %. Either add security_invoker = on, or revoke select from authenticated.', bad;
  end if;
end $$;

-- ── 4) AND THE ANON SIDE, WHICH IS THE WORSE HALF IF IT EVER SLIPS ─────────────────────────────
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname <> 'market_live'
     and has_table_privilege('anon', c.oid, 'select');
  if bad is not null then
    raise exception 'These views are readable by a logged-OUT visitor: %.', bad;
  end if;
end $$;

comment on view public.v_crew_person is
  'One crew member, whole. security_invoker = on (0312): this honours the RLS on profiles, so a member sees their own row and a staff member sees the crew — which is what the base tables always said and what the view used to walk around.';

-- ── 5) what changed ────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Views no longer walk around the security on the tables underneath','fix','System',
   'Row-level security decides who can read what in this app, and it was working: a customer account reads exactly one row from the profiles table — their own. But 35 of the 40 saved queries built on top of those tables ran with the database owner''s privileges instead of the reader''s, so the same account could read the whole crew through a view. Nothing has leaked: every account today belongs to the crew. The storefront is open though, and the first customer who signs up would have had that access. The internal diagnostics are now closed to customers entirely, the views the app uses honour the same rules as their tables, and the release check refuses any future view that repeats it.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0312_a_view_is_a_side_door',
  'revoked 21 diagnostic views from anon/authenticated; security_invoker on the 13 the app reads; self-asserting so a definer view granted to authenticated fails the migration.');

-- verify:
--   -- as a member, the number that mattered:
--   begin;
--     select set_config('request.jwt.claims', json_build_object(
--       'sub',(select id::text from public.profiles where role='member' limit 1),
--       'role','authenticated')::text, true);
--     set local role authenticated;
--     select count(*) from public.profiles;       -- 1
--     select count(*) from public.v_crew_person;  -- 1  (was 3)
--     select count(*) from public.v_delete_rights;-- permission denied (was 143)
--   rollback;
--   -- and the crew census, which must not move:
--   select c.relname, coalesce(array_to_string(c.reloptions,','),'') from pg_class c
--     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' order by 1;
