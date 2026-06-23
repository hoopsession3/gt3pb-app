-- 0047 — read-only BI role for Metabase / Looker Studio (owner's ad-hoc deep dives).
-- A LOGIN role that can ONLY SELECT, with BYPASSRLS so analytics sees all rows (read-only =
-- safe — it can read everything but write nothing). Idempotent.
--
-- ⚠️ SET A PASSWORD before connecting (do NOT commit it):
--     alter role bi_readonly with password '<a-strong-password>';
-- Then connect the BI tool with: host + port 5432 (or the pooler), db = postgres,
-- user = bi_readonly, that password, SSL required. Connection host is in
-- Supabase → Project Settings → Database.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bi_readonly') then
    create role bi_readonly login;
  end if;
exception when insufficient_privilege then raise notice 'bi_readonly: cannot create role from here'; end $$;

grant connect on database postgres to bi_readonly;
grant usage on schema public to bi_readonly;
grant select on all tables in schema public to bi_readonly;
alter default privileges in schema public grant select on tables to bi_readonly;

-- Analytics must see all rows; read-only so it stays safe. No-op if the platform won't grant it.
do $$ begin
  alter role bi_readonly bypassrls;
exception when others then raise notice 'bi_readonly: bypassrls not granted — use the postgres connection or grant manually'; end $$;
