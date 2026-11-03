-- IMS8 — WHO MAY CALL WHICH PRIVILEGED FUNCTION (read-only; function names and true/false only).
-- Every SECURITY DEFINER function in public that an API role (anon, authenticated) may execute, and whether its search_path
-- is pinned. Compared on 2026-11-03 with supabase/schema.security.json (pulled at ledger 0440): 139 callable (snapshot
-- 127) — the 12 new ones are exactly scripts/security.audit.mjs PRIVILEGED_SINCE_SNAPSHOT (0441, 0444 ×3, 0447, 0462 ×4,
-- 0467, 0472 ×2), none gone; callable signed out 16 (snapshot 15): + primal_lesson_previews (0441), + vision_shared (0447),
-- − primal_menu_for_lesson (no longer anon). Every one has a pinned search_path.
-- This is not the snapshot: the audit's ceilings (publicRead, definerView, the policies) are judged only on a full re-pull
-- of scripts/security.snapshot.sql.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       coalesce(array_to_string(p.proconfig, ',') like '%search_path%', false) as search_path_pinned
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;
