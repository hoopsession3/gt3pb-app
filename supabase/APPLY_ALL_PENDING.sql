-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0401
-- generated-at: 2026-10-14
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0401_a_signed_out_caller_reaches_only_what_is_meant_for_it.sql
-- ============================================================
-- ── 0401 — A SIGNED-OUT CALLER REACHES ONLY WHAT IS MEANT FOR IT ─────────────────────────────────────────────────
-- 2026-10-14. Found by the security snapshot pulled at ledger 0400 (supabase/schema.security.json, read with the owner's
-- yes through the Supabase connector) and Supabase's own advisors, read the same afternoon.
--
-- WHY. Supabase grants every function made in public to anon, authenticated and service_role BY NAME — its default
-- privileges for the postgres role — on top of the grant to PUBLIC that Postgres makes. 0381 closed the half-revoke that
-- names anon and leaves PUBLIC; this is the other half. A revoke that names public alone ("revoke all … from public;
-- grant execute … to authenticated" — 0292, 0394 and others) leaves anon's own grant standing, and a function no
-- migration ever revoked keeps both. 55 SECURITY DEFINER functions answered a caller with no session at all — the anon key
-- every phone carries — and 44 of them were never granted to anon by any migration.
--   · Every one of the 44 checks who is calling, or answers a caller with no session with nothing — save two.
--     respond_to_offer and respond_to_agreement ask "is this yours?" as `candidate_user_id is distinct from auth.uid()`,
--     and with no session that is null against null: not distinct. An offer letter sent to an email with no account yet
--     (candidate_user_id null), or an agreement not yet tied to its operator, could be accepted, declined or countered by
--     anyone holding its id, signed in or not. The app calls both only after sign-in (/offer, the operator's own copy), so
--     the door was the API's, not the app's. Both now refuse a caller with no session before anything else.
--   · Three told anyone who asked about the business: market_brew_capacity (a market's vessels and gallons),
--     resolve_ingredient (the shelf item behind a recipe ingredient), my_member_benefits (empty without a session).
--
-- WHAT. EXECUTE is taken from PUBLIC, anon and authenticated on 41 of the 44 — every overload, by name — and given back by
-- name to authenticated and service_role exactly where each had it, so nothing a signed-in person, the server, the cron or
-- a trigger does changes. Kept for anon, as before: effective_tenant and is_owner (row-level policies judge signed-out
-- readers with them) and primal_menu_for_lesson (a published rookie lesson is read signed out, drink stack and all).
-- The eleven granted to anon by name (the ticket's own calls, the stop's menu, is_admin and is_staff for policies, …) are
-- not touched. The app calls none of the 41 signed out: the cup reminder's button is drawn for a member only, and
-- trackUser swallows its own answer.
-- Also from the advisors, cheap and certain:
--   · two indexes that are another index twice: rsvps_one_per_member (0016) is rsvps_member_once (0232) again, and
--     products_tenant_idx — made by hand in production, in no migration — is products_tenant (0062) again.
--   · 28 functions with no fixed search_path (triggers and helpers, all SECURITY INVOKER, none in an index) get
--     `public`, as every other function here has.
-- scripts/drift.check.mjs's REVOKE GATE holds the other half from here on: a function revoke that names public names anon
-- and authenticated as well, and grants back by name whoever should keep it.
-- A second run changes nothing.
-- changelog: none — nothing anyone does in the app changes; the doors closed were the API's, never the app's.

-- ── the two that let a stranger answer ─────────────────────────────────────────────────────────────────────────────
-- 0281's function, and a caller with no session is refused first.
create or replace function public.respond_to_offer(p_id uuid, p_action text, p_note text default null)
returns public.offer_letters language plpgsql security definer set search_path = public as $$
declare o public.offer_letters; nxt text; me_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to answer your offer.' using errcode = '28000';
  end if;
  select * into o from public.offer_letters where id = p_id;
  if not found then raise exception 'No such offer.'; end if;

  me_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if o.candidate_user_id is distinct from auth.uid()
     and lower(o.candidate_email) is distinct from me_email then
    raise exception 'Only the person this offer is for can respond to it.';
  end if;
  if o.status not in ('sent','countered') then
    raise exception 'This offer is not open for a response right now (it is %).', o.status;
  end if;
  if o.expires_on is not null and o.expires_on < current_date then
    update public.offer_letters set status = 'expired', updated_at = now() where id = p_id;
    raise exception 'This offer expired on %.', o.expires_on;
  end if;

  nxt := case p_action when 'accept' then 'accepted'
                       when 'decline' then 'declined'
                       when 'counter' then 'countered' else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, decline or counter.', p_action; end if;

  update public.offer_letters
     set status = nxt,
         responded_at = now(),
         -- link the account on first response, so later reads stop depending on the email match
         candidate_user_id = coalesce(candidate_user_id, auth.uid()),
         updated_at = now()
   where id = p_id returning * into o;

  update public.offer_events set note = coalesce(p_note, note)
   where id = (select id from public.offer_events where offer_id = p_id order by at desc limit 1);

  return o;
end $$;

-- 0277's function, and a caller with no session is refused first.
create or replace function public.respond_to_agreement(p_id uuid, p_action text, p_note text default null)
returns public.operator_agreements
language plpgsql security definer set search_path = public as $$
declare a public.operator_agreements; nxt text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to answer your agreement.' using errcode = '28000';
  end if;
  select * into a from public.operator_agreements where id = p_id;
  if not found then raise exception 'No such agreement.'; end if;
  if a.operator_user_id is distinct from auth.uid() then
    raise exception 'Only the operator this agreement is for can respond to it.';
  end if;
  if a.status not in ('sent','countered') then
    raise exception 'This agreement is not open for a response right now (it is %).', a.status;
  end if;

  nxt := case p_action
           when 'accept' then 'accepted'
           when 'request_changes' then 'changes_requested'
           when 'counter' then 'countered'
           else null end;
  if nxt is null then raise exception 'Unknown response: %. Use accept, request_changes or counter.', p_action; end if;

  update public.operator_agreements
     set status = nxt,
         accepted_at = case when nxt = 'accepted' then now() else accepted_at end,
         updated_at = now()
   where id = p_id
   returning * into a;

  -- the note is the operator's, so it is recorded against them explicitly
  update public.operator_agreement_events
     set note = coalesce(p_note, note)
   where id = (select id from public.operator_agreement_events
                where agreement_id = p_id order by at desc limit 1);

  return a;
end $$;

-- ── closed to a caller with no session ─────────────────────────────────────────────────────────────────────────────
-- Each overload: whether authenticated and service_role may call it is read first, then EXECUTE is taken from PUBLIC,
-- anon and authenticated, and given back by name to whichever of the two had it. A name with no function is an error,
-- not a skip — a typo here would leave a door open and say nothing.
do $$
declare
  names text[] := array[
    'admin_set_display_name', 'admin_set_driver', 'admin_set_event_live', 'admin_set_live', 'admin_set_member',
    'admin_set_offline', 'admin_set_role', 'admin_set_truck_pos', 'attach_referral', 'award_manual_point',
    'cancel_reserve_claim', 'current_tenant', 'decide_on_offer', 'drop_cup_reminder', 'ensure_batch_steps',
    'generate_office_route', 'is_market_lead', 'keep_cup_reminder', 'leads_market', 'log_batch_use',
    'map_ingredient', 'market_brew_capacity', 'member_by_code', 'my_member_benefits', 'promote_to_crew',
    'receive_lot', 'reset_inventory_count', 'resolve_ingredient', 'respond_to_agreement', 'respond_to_offer',
    'set_batch_step', 'set_market_lead', 'set_market_live', 'set_market_offer_disclaimer', 'set_market_office_terms',
    'set_market_opens_on', 'set_member_market', 'submit_offer_for_review', 'tidy_stale_content', 'track_user',
    'void_expense'];
  missing text[];
  f regprocedure;
  auth_had boolean;
  svc_had boolean;
  n int := 0;
begin
  select array_agg(x order by x) into missing
    from unnest(names) x
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and p.proname = x);
  if missing is not null then
    raise exception '0401: no function named %', missing;
  end if;
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = any (names)
     order by p.oid::regprocedure::text
  loop
    auth_had := has_function_privilege('authenticated', f, 'execute');
    svc_had  := has_function_privilege('service_role', f, 'execute');
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if auth_had then execute format('grant execute on function %s to authenticated', f); end if;
    if svc_had then execute format('grant execute on function %s to service_role', f); end if;
    n := n + 1;
  end loop;
  raise notice '0401: % function(s) closed to a caller with no session.', n;
end $$;

-- ── an index that is another index twice ───────────────────────────────────────────────────────────────────────────
drop index if exists public.rsvps_one_per_member;    -- rsvps_member_once (0232) is the same unique index
drop index if exists public.products_tenant_idx;     -- made by hand in production; products_tenant (0062) is the same

-- ── a fixed search_path for the last 28 ────────────────────────────────────────────────────────────────────────────
do $$
declare
  names text[] := array[
    'agreement_digest', 'brew_needed_by', 'brew_ready_at', 'brew_start_date', 'company_program_active_since',
    'guard_agreement_delete', 'guard_agreement_terms', 'guard_asset_delete', 'guard_customer_delete',
    'guard_expense_delete', 'guard_offer_delete', 'guard_permanent_record', 'guard_shop_order_terminal',
    'office_horizon', 'office_request_label', 'office_rule_matches', 'office_untouched', 'similar_vendors',
    'stamp_status_change', 'sync_delivery_status', 'sync_drop_stage', 'sync_field_op_id', 'sync_order_status',
    'sync_pack_status', 'touch_order_status', 'touch_updated_at', 'vendor_dupe_candidates', 'vendor_similarity_guard'];
  missing text[];
  f regprocedure;
begin
  select array_agg(x order by x) into missing
    from unnest(names) x
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and p.proname = x);
  if missing is not null then
    raise exception '0401: no function named %', missing;
  end if;
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = any (names)
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
     order by p.oid::regprocedure::text
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

select public.record_migration('0401_a_signed_out_caller_reaches_only_what_is_meant_for_it');

-- verify (numbers and booleans only):
--   select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
--    where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');            -- 14
--   select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
--    where s.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute');   -- 116
--   select has_function_privilege('anon', 'public.admin_set_role(uuid,text)', 'execute');                        -- false
--   select has_function_privilege('authenticated', 'public.admin_set_role(uuid,text)', 'execute');               -- true
--   select has_function_privilege('anon', 'public.effective_tenant()', 'execute');                               -- true
--   select count(*) from pg_indexes where indexname in ('rsvps_one_per_member', 'products_tenant_idx');          -- 0
--   select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
--    where s.nspname = 'public' and p.prokind = 'f'
--      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
--      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%'); -- 0
