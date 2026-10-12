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
-- pending-from: 0387
-- generated-at: 2026-10-12
-- pending-count: 2
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

-- ============================================================
-- 0387_a_free_cup_is_redeemed_once.sql
-- ============================================================
-- ── 0387 — A FREE CUP IS REDEEMED ONCE ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. C6 of the customer frontend audit; the owner approved its R1 on 2026-10-12, with the redeem button on the
-- crew's scan screen (decision 3) and the free-cup balance counted from launch (decision 2).
--
-- WHY. Every tenth cup is on us, and nothing recorded a free cup as given. The ledger (0229) knows award, clawback and
-- adjust; the card counts every ten points as a free cup, forever — so a member with 20 points was owed two free cups
-- after drinking both, and the crew had no way to say one was used. Counting from launch is clean: nobody in production
-- holds ten points today (read-only count, 2026-10-12), so no free cup is owed from before this.
--
-- WHAT.
--   · loyalty_ledger.kind gains 'redeem': a free cup given at the window is one row of −10. profiles.points stays the
--     ledger's sum (0229's apply trigger), so a card shows what is left: points % 10 stamps, points / 10 free cups ready.
--   · loyalty_ledger.by_user: who wrote a row by hand at the window — the crew member who redeemed (and, once the
--     scan is changed, who scanned). Null for rows the system writes.
--   · redeem_free_cup(code): the crew's scan screen, after a confirm. Staff only (is_staff, as award_manual_point asks);
--     the member by their card code; refused unless they hold ten points; the profile row locked first, so two crew
--     phones redeeming at once cannot give two cups for one. Returns the member's points after.
-- Untouched: award_manual_point, credit_wallet, the apply trigger, every reader of profiles.points.
--
-- ORDER. Paste it before the deploy that carries the Redeem button: before it is pasted the button answers "Couldn't
-- redeem — try again" (the function is missing, PGRST202), and nothing else changes.
--
-- existing rows: none written; the check constraint is widened, and a nullable column added.
-- changelog: below.

alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_kind_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_kind_check
  check (kind in ('award', 'clawback', 'adjust', 'redeem'));
alter table public.loyalty_ledger add column if not exists by_user uuid references auth.users(id) on delete set null;
comment on column public.loyalty_ledger.by_user is
  'Who wrote this row by hand at the window (0387): the crew member who redeemed a free cup. Null for system rows.';

create or replace function public.redeem_free_cup(p_code text) returns int
  language plpgsql security definer set search_path = public as $$
declare uid uuid; cur int; after int;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select p.id, coalesce(p.points, 0) into uid, cur from public.profiles p
   where p.referral_code = p_code or p.id::text = p_code
   limit 1
   for update;
  if uid is null then return null; end if;
  if cur < 10 then raise exception 'no free cup to redeem' using errcode = 'P0001'; end if;
  insert into public.loyalty_ledger (user_id, channel, kind, points, note, by_user)
    values (uid, 'scan', 'redeem', -10, 'free cup redeemed at the window', auth.uid());
  select coalesce(points, 0) into after from public.profiles where id = uid;
  return after;
end $$;
revoke all on function public.redeem_free_cup(text) from public, anon, authenticated;
grant execute on function public.redeem_free_cup(text) to authenticated;
comment on function public.redeem_free_cup(text) is
  'The crew''s scan screen (0387, app/scan): a free cup given at the window — one loyalty_ledger row of −10, written by who redeemed it. Staff only; refused under ten points; the profile locked first.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A free cup is redeemed once','fix','Loyalty',
   'Every tenth cup is on us, and now the crew can say one was given. Scanning a member''s card shows Redeem a free cup when they have one; it asks first, then takes ten points off the card, and the member''s card shows what is left. Two phones cannot give two cups for one, and every redemption says who gave it.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select pg_get_constraintdef(oid) like '%redeem%' from pg_constraint where conname = 'loyalty_ledger_kind_check';  -- t
--   select count(*) from information_schema.columns where table_name = 'loyalty_ledger' and column_name = 'by_user'; -- 1
--   select has_function_privilege('anon', 'public.redeem_free_cup(text)', 'execute');                              -- f
select public.record_migration('0387_a_free_cup_is_redeemed_once');
