-- 0186 — persist the member-card motto to the DB. It was device-local (localStorage) while the
-- adjacent "vision" line lives in profiles.card_vision (0183), so the shared card + PNG showed a
-- different motto per device and reverted to the default elsewhere. Give motto the same treatment.
-- profiles had table UPDATE revoked in 0008 (see 0184), so the column also needs an explicit grant.

alter table public.profiles add column if not exists card_motto text;
grant update (card_motto) on public.profiles to authenticated;

-- verify:
-- select column_name from information_schema.column_privileges
--  where table_schema='public' and table_name='profiles' and grantee='authenticated'
--    and privilege_type='UPDATE' and column_name='card_motto';  -- expect 1 row
