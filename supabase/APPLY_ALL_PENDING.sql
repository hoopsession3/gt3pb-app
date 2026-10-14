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
-- pending-from: 0402
-- generated-at: 2026-10-14
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0402_the_trucks_position_is_the_crews.sql
-- ============================================================
-- ── 0402 — THE TRUCK'S POSITION IS THE CREW'S ──────────────────────────────────────────────────────────────────────
-- 2026-10-14 (R6 of the customer audit — "guests read less of the truck row"; decided by Ryan the same day: hide it).
--
-- WHY. live_status is one row everyone may read, signed out too ("public read live", 0001): Find Us, the menu and
-- checkout ask it whether the truck is pouring. 0022 put the truck's GPS on that row — truck_lat, truck_lng,
-- pos_updated_at — streamed from the crew's phone every 8 seconds while Live Ops broadcasts. So anyone holding the
-- public key could read where the truck stood, to the metre, and every write went out on realtime to every open Find Us
-- page. No customer page has drawn it since the route map went (b6af016, 2026-10-10); the crew's Live Ops shows when it
-- was last pinned, and that is all. RLS is row-level — a column on a public row cannot be hidden by a policy (0195's
-- lesson) — so the position moves to a row of its own that only the crew can read.
--
-- WHAT.
--   · truck_position — the one row (id 1): where the truck is, and since when. RLS on; the crew read it (is_staff);
--     nobody writes it but the two functions below. In the realtime publication, for the crew's other screens.
--   · admin_set_truck_pos writes it and admin_set_offline clears it — the same calls, the same check (is_admin), the
--     same callers (0401: a signed-in session and the server, never PUBLIC or anon).
--   · what live_status held is carried over, and its three columns are dropped.
-- Code first: components/crew/LiveControl reads the new row (and the old columns until this is pasted); Find Us asks
-- live_status for named columns, never *.
-- A second run changes nothing.
-- changelog: none — nothing a customer sees changes; the position was never drawn for them.

create table if not exists public.truck_position (
  id             integer primary key default 1 check (id = 1),
  truck_lat      double precision,
  truck_lng      double precision,
  pos_updated_at timestamptz
);
comment on table public.truck_position is
  'The truck''s position (0402): the crew''s alone — moved off live_status, which everyone may read.';

alter table public.truck_position enable row level security;
revoke all on public.truck_position from public, anon, authenticated;
grant select on public.truck_position to authenticated;
grant all on public.truck_position to service_role;
drop policy if exists truck_position_crew_read on public.truck_position;
create policy truck_position_crew_read on public.truck_position for select to authenticated using ((select public.is_staff()));

-- What live_status held, carried over — once: on a second run its columns are gone and this is skipped.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'live_status' and column_name = 'truck_lat') then
    execute $q$
      insert into public.truck_position (id, truck_lat, truck_lng, pos_updated_at)
      select 1, l.truck_lat, l.truck_lng, l.pos_updated_at from public.live_status l where l.id = 1
      on conflict (id) do update
        set truck_lat = excluded.truck_lat, truck_lng = excluded.truck_lng, pos_updated_at = excluded.pos_updated_at
    $q$;
  end if;
end $$;

-- 0022's, writing the crew's row instead of the public one.
create or replace function public.admin_set_truck_pos(lat double precision, lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  insert into public.truck_position (id, truck_lat, truck_lng, pos_updated_at) values (1, lat, lng, now())
  on conflict (id) do update
    set truck_lat = excluded.truck_lat, truck_lng = excluded.truck_lng, pos_updated_at = excluded.pos_updated_at;
end; $$;

-- 0022's: off the road, the stop demoted, and the position cleared — now on the crew's row.
create or replace function public.admin_set_offline()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.stops set status = 'upcoming' where status = 'live';
  insert into public.live_status (id, is_live, current_stop_id) values (1, false, null)
  on conflict (id) do update set is_live = false, current_stop_id = null;
  update public.truck_position set truck_lat = null, truck_lng = null, pos_updated_at = null where id = 1;
end; $$;

-- Who may call them, as 0401 left it: a signed-in session (the function checks is_admin) and the server.
revoke execute on function public.admin_set_truck_pos(double precision, double precision) from public, anon, authenticated;
grant execute on function public.admin_set_truck_pos(double precision, double precision) to authenticated, service_role;
revoke execute on function public.admin_set_offline() from public, anon, authenticated;
grant execute on function public.admin_set_offline() to authenticated, service_role;

alter table public.live_status drop column if exists truck_lat;
alter table public.live_status drop column if exists truck_lng;
alter table public.live_status drop column if exists pos_updated_at;

do $$ begin
  alter publication supabase_realtime add table public.truck_position;
exception when duplicate_object then null; when undefined_object then null; end $$;

select public.record_migration('0402_the_trucks_position_is_the_crews');

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'live_status'
--      and column_name in ('truck_lat', 'truck_lng', 'pos_updated_at');                                          -- 0
--   select relrowsecurity from pg_class where relname = 'truck_position';                                        -- true
--   select has_table_privilege('anon', 'public.truck_position', 'select');                                       -- false
--   select has_function_privilege('anon', 'public.admin_set_truck_pos(double precision,double precision)', 'execute'); -- false
--   select has_function_privilege('authenticated', 'public.admin_set_offline()', 'execute');                     -- true
