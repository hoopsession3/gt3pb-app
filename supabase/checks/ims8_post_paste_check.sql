-- IMS8 — POST-PASTE CHECK for 0468–0472 (read-only; names and flags only — never a token, a row's words or a key).
-- Run 2026-11-03 ~01:01 UTC against project gt3pb (production), straight after 0472 was applied: all 15 rows ok = true.
-- Unchanged from the release package's IMS8-POST-PASTE-CHECK.sql (validated first against the migrations replayed in PGlite).

with checks(name, ok) as (
  -- the ledger
  select 'ledger: 0468..0472 recorded', (select count(*) from public.schema_migrations where version in (
     '0468_a_link_leaves_no_key_behind', '0469_a_size_as_it_was_said', '0470_a_price_says_what_kind',
     '0471_an_ask_says_whether_it_is_set', '0472_a_link_sends_what_you_reviewed')) = 5
  -- 0468: the activity log is per business and append-only for the API
  union all select '0468: admin_audit.tenant_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admin_audit' and column_name = 'tenant_id')
  union all select '0468: restrictive tenant policy on admin_audit', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_audit' and policyname = 'audit tenant isolation' and permissive = 'RESTRICTIVE')
  union all select '0468: authenticated cannot insert/update/delete admin_audit', not (has_table_privilege('authenticated', 'public.admin_audit', 'INSERT') or has_table_privilege('authenticated', 'public.admin_audit', 'UPDATE') or has_table_privilege('authenticated', 'public.admin_audit', 'DELETE'))
  union all select '0468: anon cannot read admin_audit', not has_table_privilege('anon', 'public.admin_audit', 'SELECT')
  union all select '0468: no link audit line carries a token key', not exists (select 1 from public.admin_audit where table_name = 'vision_shares' and (coalesce(old_row, '{}'::jsonb) ? 'token' or coalesce(new_row, '{}'::jsonb) ? 'token'))
  -- 0471: an ask can say "not set"
  union all select '0471: vision_asks.amount_cents is nullable', (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'vision_asks' and column_name = 'amount_cents') = 'YES'
  -- 0472: the published revision, and the one door
  union all select '0472: vision_shares.published, revision etc. exist', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vision_shares'
     and column_name in ('published', 'published_fingerprint', 'published_at', 'published_by', 'confirmed', 'revision')) = 6
  union all select '0472: every live link has a published revision (revision 1 or more)', not exists (select 1 from public.vision_shares where revoked_at is null and (published is null or revision < 1))
  union all select '0472: authenticated cannot INSERT vision_shares', not has_table_privilege('authenticated', 'public.vision_shares', 'INSERT')
  union all select '0472: authenticated may UPDATE revoked_at only', has_column_privilege('authenticated', 'public.vision_shares', 'revoked_at', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.vision_shares', 'program_ids', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.vision_shares', 'money_plans', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.vision_shares', 'pinned_at', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.vision_shares', 'published', 'UPDATE')
  union all select '0472: review and publish are definers, search_path pinned, authenticated only', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('vision_share_review', 'vision_share_publish') and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path%'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 2
  union all select '0472: the helpers are callable by no API role', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('vision_share_live', 'vision_share_candidate', 'vision_share_material', 'vision_share_texts', 'vision_share_internal', 'vision_share_private_names', 'vision_share_fingerprint', 'vision_share_payload')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
  union all select '0472: the door is still anon-callable', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'vision_shared' and has_function_privilege('anon', p.oid, 'execute'))
  union all select '0472: published_by is indexed', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vision_shares_published_by')
)
select name, ok from checks order by ok, name;
