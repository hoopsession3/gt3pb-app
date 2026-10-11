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
-- pending-from: 0367
-- generated-at: 2026-10-11
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0367_alerts_in_the_iphone_app.sql
-- ============================================================
-- ── 0367 — ALERTS IN THE IPHONE APP ───────────────────────────────────────────────────────────────────
-- 2026-10-11 (the App Store pass: "Turn on alerts" was taken out of the iPhone app because the app had nothing to
-- turn on — the web's push needs a browser's push service, and an app is reached through Apple's, APNs).
--
-- A phone running the app registers with Apple and gets a device token; the app keeps it here, as the web keeps a
-- browser's subscription, so the push function (supabase/functions/push) can reach it. Same table, same rules
-- (0006, 0009, 0081; 0365 decides who is marked for new orders), one more kind of row:
--
--   platform 'web'   the browser's subscription — endpoint, p256dh, auth, as before;
--   platform 'apns'  the app's device token — endpoint 'apns:<token>' (unique, as every endpoint is), no keys.
--
-- A web row still needs its two keys (the check below), so nothing that was true of a web row stops being true.
--
-- THE DATABASE KEEPS THE PHONE (keep_app_push_token), as it keeps a browser since 0366 (keep_push_device): for
-- whoever is signed in on it now, or nobody — it moves to them whoever had it — one app install each (a browser is
-- not one: the person's browsers keep ringing), marked for the pass's new orders only for the crew (0365's trigger
-- decides). The page wrote the row itself in this commit's first draft; the review found what 0366 had found on the
-- web: a phone someone signed out of stayed theirs, and the next person's write was refused.
--
-- And 0366's release_push_device is a signed-in person's alone: 0366 revoked it from PUBLIC, but Supabase grants a new
-- function to anon by name as well, so anon kept it (measured in production, 2026-10-11). It changed nothing for a
-- guest — the update is the caller's own row — but the grant now says what the function is for.
--
-- changelog: none yet — the line is written the day the app's alerts are switched on (APNs' key in the push function,
-- NEXT_PUBLIC_NATIVE_PUSH on the web), not the day this table can first hold a token.

alter table public.push_subscriptions add column if not exists platform text not null default 'web';
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions add constraint push_subscriptions_platform_check
  check (platform in ('web', 'apns') and (platform = 'apns' or (p256dh is not null and auth is not null)));

create or replace function public.keep_app_push_token(p_token text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_endpoint text;
begin
  if coalesce(p_token, '') !~ '^[0-9A-Fa-f]{32,200}$' then
    raise exception 'That isn''t a device token.' using errcode = '22023';
  end if;
  v_endpoint := 'apns:' || lower(p_token);
  insert into public.push_subscriptions as s (endpoint, platform, p256dh, auth, user_id, is_admin)
  values (v_endpoint, 'apns', null, null, v_user, true)          -- the mark is 0365's to give: the crew's alone
  on conflict (endpoint) do update set
    platform = 'apns', p256dh = null, auth = null,
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,                             -- stamped for whoever has it now (0134 stamp_tenant)
    is_admin = true;
  -- One app install each: the person's other phones go — a reinstall or a new phone is a new token. Browsers stay.
  if v_user is not null then
    delete from public.push_subscriptions
     where user_id = v_user and endpoint <> v_endpoint and endpoint like 'apns:%';
  end if;
end $$;
revoke all on function public.keep_app_push_token(text) from public;
grant execute on function public.keep_app_push_token(text) to anon, authenticated;

revoke execute on function public.release_push_device(text) from anon;

-- verify:
--   select platform, count(*) from public.push_subscriptions group by platform;          -- 'web' rows as before
--   select conname from pg_constraint where conname = 'push_subscriptions_platform_check';   -- one
--   select has_function_privilege('anon', 'public.release_push_device(text)', 'execute');  -- f
select public.record_migration('0367_alerts_in_the_iphone_app');
