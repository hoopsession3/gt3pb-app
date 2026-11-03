-- IMS8 — THE 0467 CHECK, RECONSTRUCTED (read-only; booleans and counts only — never a value or a token).
--
-- WHY "RECONSTRUCTED". The original 0467 post-paste check (IMS7-0467-POST-PASTE-CHECK.sql, written 2026-11-01 against
-- 0467 at 4bdf618d) was meant to run straight after 0467's paste. 0467 was pasted at 2026-11-03 00:16 UTC and that check
-- was NOT run then; 0468 and 0472 were applied after it (00:55–01:00 UTC) and replaced two of the functions it fingerprints
-- (vision_shared, vision_share_preview). So the original can't pass any more, by design, and can't say what production
-- held at 00:16. This is it rebuilt for the state production is in now: 0467's five helpers must still be 0467's exact text
-- (nothing after 0467 replaces them), and the two replaced functions must be 0472's exact text. Expected md5s come from
-- replaying supabase/migrations through 0472 (PGlite, scripts/fixtures/schema.full.mjs) at c125fb83 / f14c3dc6.
-- It proves the present state; it does not retroactively prove the state between 00:16 and 00:55 UTC.
-- Run 2026-11-03 against project gt3pb (production): every column true, links_now as found.
select
  (select count(*) from public.schema_migrations where version in ('0463_what_a_link_sends','0464_a_link_sends_named_fields_only','0467_a_link_sends_what_it_was_given')) = 3 as ledger_has_0463_0464_0467,
  -- 0467's helpers: unchanged since 0467
  (select md5(prosrc) = 'a6c41b85fca4b25b4a16292715d7d2c8' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_baseline' and pg_get_function_identity_arguments(oid) = 'b jsonb') as baseline_is_0467,
  (select md5(prosrc) = '153ce758e6c5e17fc8d58b097b82e9d8' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_keep' and pg_get_function_identity_arguments(oid) = 'o jsonb, keys text[]') as keep_is_0467,
  (select md5(prosrc) = '541e73b45a275edf2137501020f73fed' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_list' and pg_get_function_identity_arguments(oid) = 'a jsonb, keys text[]') as list_is_0467,
  (select md5(prosrc) = '21c0a3955523ee941bb19be8a9f05575' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_payload' and pg_get_function_identity_arguments(oid) = 's vision_shares') as payload_is_0467,
  (select md5(prosrc) = 'f724f383e80a88bb1e3dda6d140c0a91' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_scenario' and pg_get_function_identity_arguments(oid) = 'v jsonb') as scenario_is_0467,
  -- replaced since: now 0472's text
  (select md5(prosrc) = '0b8369efc201a983fea47e547c013981' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_preview' and pg_get_function_identity_arguments(oid) = 'p_share uuid, p_draft jsonb') as preview_is_0472,
  (select md5(prosrc) = 'f438402b7457f2c499438584827d1dd6' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_shared' and pg_get_function_identity_arguments(oid) = 'p_token text') as shared_is_0472,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_shared') = 1 as one_vision_shared,
  (select prosecdef and array_to_string(proconfig, ',') = 'search_path=public' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_preview') as preview_definer_pinned_path,
  (select prosecdef and array_to_string(proconfig, ',') = 'search_path=public' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_shared') as shared_definer_pinned_path,
  (select not has_function_privilege('anon', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_share_preview') as preview_signed_in_only,
  (select has_function_privilege('anon', oid, 'execute') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vision_shared') as link_door_open_to_anon,
  (select bool_and(not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')) from pg_proc
     where pronamespace = 'public'::regnamespace and proname in ('vision_share_payload','vision_share_scenario','vision_share_baseline','vision_share_list','vision_share_keep')) as helpers_callable_by_no_one,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares' and column_name in ('plan_ids','need_plans')) = 2 as link_columns_present,
  (select count(*) from public.vision_shares) as links_now;
