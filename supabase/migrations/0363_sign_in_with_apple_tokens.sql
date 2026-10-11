-- ── SIGN IN WITH APPLE: THE TOKEN DELETING AN ACCOUNT REVOKES ─────────────────────────────────────────────────────
-- 2026-10-11 (Ryan: "you have permission to do anything"). The iPhone app signs in with Apple's own sheet
-- (native/ios/GT3Device.swift signInWithApple; AuthProvider signInWithApple). Apple expects an app that lets people
-- delete their account to revoke what Sign in with Apple gave it when they do (TN3194). Revoking takes the refresh
-- token the sheet's one-time authorization code is traded for (lib/appleSignIn), so it is kept here, one per person:
--
--   written  app/api/auth/apple       — right after the sign-in, once the code's id token names this person's own
--                                       Apple identity (apple_user, Apple's `sub` for them);
--   used     app/api/account/erase    — revoked at Apple before the account is deleted;
--   gone     with the account          — on delete cascade.
--
-- Only the server reads or writes it (the service role): row level security is on and there is no policy, and the
-- signed-in roles hold no grant on it, so nobody signed in — its owner included — can read a token.

create table if not exists public.apple_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apple_user text not null,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.apple_tokens enable row level security;
revoke all on table public.apple_tokens from anon, authenticated;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Sign in with Apple in the iPhone app','feature','Account',
   'In the GT3 iPhone app, Continue with Apple signs you in or makes your account with Face ID — no code, no password. Apple can hide your email behind a private relay address; receipts and sign-in codes still reach you. Deleting your account also ends Sign in with Apple for GT3.',
   '2026-10-11', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select relrowsecurity from pg_class where oid = 'public.apple_tokens'::regclass;   -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'apple_tokens';   -- 0
--   select has_table_privilege('authenticated', 'public.apple_tokens', 'select');   -- false
select public.record_migration('0363_sign_in_with_apple_tokens');
