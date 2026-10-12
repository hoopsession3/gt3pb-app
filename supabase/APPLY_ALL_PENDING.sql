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
-- pending-from: 0386
-- generated-at: 2026-10-12
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0386_a_switch_with_no_truck_behind_it_is_off.sql
-- ============================================================
-- ── 0386 — A SWITCH WITH NO TRUCK BEHIND IT IS OFF ───────────────────────────────────────────────────────────────────
-- 2026-10-12. C1 of the customer frontend audit; the owner approved its R1 ("yes to all improvements") on 2026-10-12.
--
-- WHY. The live switch (live_status) names the stop the truck went live at. Stamping that stop complete turned the switch
-- off (0125, sync_stop_completion) — but archiving the stop, or marking it done, did not. A stop archived from its sheet
-- or the schedule, outside Live Ops' Go offline, left the switch on with no stop behind it, and the app believed the
-- switch: Find Us said Live, and cup orders opened and charged with nobody at the truck. The app now judges a switch by
-- the stop it names (lib/ordering liveSwitchOn, in the same release); this keeps the switch itself honest, so the crew's
-- Live Ops and the customer's Find Us read the same thing.
--
-- WHAT.
--   · sync_stop_completion: the live stop leaving the road — stamped complete (as before), archived, or marked done —
--     turns the switch off and clears its stop. Completing still marks the stop done, as before.
--   · Existing rows: a switch that is on now while its stop is already archived, done or complete is turned off, once.
--     The truck-offline alert (0052) fires for it, as for any switch going off: one line in the crew's inbox, "Truck went
--     offline — confirm this was intended."
-- Untouched: admin_set_live, admin_set_offline, each city's own switch (markets.is_live, 0285), the trigger itself
-- (stops_completion_sync, 0125: redefining its function is enough), and a switch whose stop is still open.
--
-- ORDER. Either side of the deploy: the app already treats such a switch as off; this makes the row say so.
--
-- existing rows: the one update below — at most one row (live_status is a singleton). A second run finds nothing to do.
-- changelog: below.

create or replace function public.sync_stop_completion() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.status := 'done';
  end if;
  -- The live stop leaving the road takes the switch with it, however it left.
  if (new.completed_at is not null and old.completed_at is null)
     or (new.archived_at is not null and old.archived_at is null)
     or (new.status = 'done' and old.status is distinct from 'done') then
    update public.live_status set is_live = false, current_stop_id = null
     where id = 1 and current_stop_id = new.id;
  end if;
  return new;
end; $$;

-- A switch on today whose stop already left the road.
update public.live_status ls set is_live = false, current_stop_id = null
 where ls.id = 1 and ls.is_live and ls.current_stop_id is not null
   and exists (select 1 from public.stops s
                where s.id = ls.current_stop_id
                  and (s.archived_at is not null or s.status = 'done' or s.completed_at is not null));

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The truck reads live only while it is there','fix','Ordering',
   'A live switch left on no longer opens cup orders. The switch counts only while the stop it was flipped at is still a stop: archiving that stop or marking it done now turns the switch off, as completing it always did, and a stop with no close time ends 8 hours after its start. Find Us stops saying Live at the same moment, so nobody is charged for a cup with no one at the truck.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from pg_trigger where tgname = 'stops_completion_sync' and not tgisinternal;       -- 1
--   select position('archived_at' in prosrc) > 0 from pg_proc where proname = 'sync_stop_completion';  -- t
--   select count(*) from public.live_status ls join public.stops s on s.id = ls.current_stop_id
--    where ls.is_live and (s.archived_at is not null or s.status = 'done' or s.completed_at is not null);  -- 0
select public.record_migration('0386_a_switch_with_no_truck_behind_it_is_off');
