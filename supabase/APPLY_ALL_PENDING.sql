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
--
-- EACH MIGRATION IS ITS OWN TRANSACTION (R32 — the 10/10 audit, DB11-04 and OPS11-03). A paste runs as one transaction
-- unless it says otherwise, so a lock one migration took was held to the end of all of them, and one that stopped took
-- the others back with it. Each section below is wrapped in its own begin … commit: its locks end with it, and if one
-- stops (a busy table's lock wait ran out), the ones above it stay applied and nothing below it runs — paste the file
-- again a moment later; a migration already applied changes nothing the second time.
-- pending-from: 0438
-- generated-at: 2026-10-19
-- pending-count: 1
-- ledger-read-from: hand-read from the SQL editor
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- held: 0424_a_password_set_before_the_proof_waits_for_it_everywhere.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0438_a_way_back_without_the_authenticator.sql
-- ============================================================
begin;   -- 0438, its own transaction: if it stops, what is above it stays applied and nothing below it runs — paste the file again
-- ── 0438 — A WAY BACK WITHOUT THE AUTHENTICATOR ──────────────────────────────────────────────────────────────────────
-- 2026-10-19. R37 of the 10/10 audit (the fresh audit at R31: accessibility UX11-10; Ryan, 2026-10-19: "Recovery codes").
-- Paste into Supabase → SQL Editor → Run. A second run changes nothing.
--
-- WHY. Two-step (0433) holds every owner's and admin's power to an authenticator's code. An owner who lost their phone
-- had one way back: another owner — or someone with the database's dashboard — taking the lost authenticator off their
-- account (0433's NO LOCKOUT). The business's only owner had no other owner, and someone who can't use the dashboard
-- had no way at all.
--
-- WHAT. two_step_recovery_codes: ten one-time codes for each person who sets up an authenticator, made by the app's
-- server (app/api/two-step/codes — on a sign-in that gave the authenticator's code) and shown to them once, to print or
-- keep in Passwords. Any one of them, given on a sign-in proved in the last few minutes (app/api/two-step/recover), is
-- used up and takes the lost authenticator off the account through Supabase's own admin door; they set up a new one,
-- and the owners and admins are told it happened. A code is kept as its hash with its own salt (lib/recoveryCodes:
-- scrypt), never as itself. The table is closed to every API role — no policy, no grant — and only the server, with its
-- own key, reads or writes it.
--
-- set lock_timeout (database F16): a new table and its index — nothing existing is locked.
-- existing rows: none — nobody has codes until they set up an authenticator, or make new ones in Settings & privacy.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.two_step_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null check (code_hash like 's1$%'),   -- lib/recoveryCodes: scrypt, its salt beside it — never the code
  made_at    timestamptz not null default now(),
  used_at    timestamptz
);
-- The person's codes, and which are still unused: the key's own index (0435's rule — a delete of an account finds them).
create index if not exists two_step_recovery_codes_user_id_fk_idx on public.two_step_recovery_codes (user_id, used_at);
comment on table public.two_step_recovery_codes is
  'Two-step recovery codes (0438): ten one-time codes per person with an authenticator, kept as scrypt hashes (lib/recoveryCodes). Made and used only by the app''s server (app/api/two-step/codes and recover) with its own key; closed to every API role. A used code takes the lost authenticator off the account; the owners and admins are told.';

alter table public.two_step_recovery_codes enable row level security;
revoke all on public.two_step_recovery_codes from public, anon, authenticated;
grant select, insert, update, delete on public.two_step_recovery_codes to service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A way back without your authenticator', 'security', 'Account',
   'Setting up two-step sign-in now gives you ten one-time recovery codes to print or keep in Passwords. If you lose your authenticator, one of them — on a fresh sign-in — takes the lost one off your account so you can set up a new one, and the owners are told.',
   '2026-10-19', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select relrowsecurity from pg_class where oid = 'public.two_step_recovery_codes'::regclass;                   -- t
--   select has_table_privilege('authenticated', 'public.two_step_recovery_codes', 'select');                      -- f
--   select has_table_privilege('anon', 'public.two_step_recovery_codes', 'select');                               -- f
--   select count(*) from pg_policy where polrelid = 'public.two_step_recovery_codes'::regclass;                   -- 0
select public.record_migration('0438_a_way_back_without_the_authenticator');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
commit;  -- 0438
