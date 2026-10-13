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
-- pending-from: 0397
-- generated-at: 2026-10-13
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0397_a_pack_belongs_to_its_stop.sql
-- ============================================================
-- ── 0397 — A PACK BELONGS TO ITS STOP, AND CLOSES WHEN ITS STOP SAYS ─────────────────────────────────────────────────
-- 2026-10-13 (R5 of the customer audit — "One pickup-day rule … The cancel cutoff … Packs linked to their stop").
--
-- WHY. A pack recorded only its day (drop_orders.drop_date). Its stop — the place, the time, whether the truck is still
-- coming — was guessed from the day, differently in each place that needed it: the order rule closed a pack 24 hours
-- before its stop; Move and Change, finding a canceled stop gone from the schedule, fell back to "three days before at
-- 6pm" and refused ("This pack's drop has closed") the very customers the cancel text had told to move it; a stop
-- rescheduled to another day left its packs on the old one; and the member's own cancel (cancel_own_reservation, 0341)
-- had no time or stage check at all — a pack could be canceled, and flagged for a refund, while it was brewing or
-- ready on pickup day, whatever the pay screen said about "before the drop closes".
--
-- WHAT.
--   · drop_orders.stop_id — the stop a pack is picked up at (stops; a stop deleted leaves it null). Backfilled from the
--     pack's day: that day's first stop on the schedule still taking packs, else its first, else the day's stop that was
--     called off. Kept true by a trigger for every writer — the reserve route, Move, a change in place (0388), the crew's
--     board — a pack whose day changes without a stop named for it is linked to that day's first stop still taking packs.
--   · A stop moved to another day takes its packs with it (they are picked up at the stop), and the crew hear how many.
--   · pack_closes_at(day, stop) — THE rule for when a pack's drop closes, said once: 24 hours before its stop (the packs
--     are brewed to order); a stop called off never closes it (moving or canceling is the customer's call then); with no
--     stop, the Saturday rule — three days before, 6pm Eastern. lib/pickupDay says the same for the screens.
--   · cancel_own_reservation — only while the pack is reserved (not preparing, ready, on its way or picked up) and its
--     drop is open; otherwise it changes nothing and says no, and /api/orders/cancel says why.
--   · cancel_stop (0391) counts the packs for the stop itself (and unlinked ones for its day when no other stop is left).
--
-- A second run changes nothing.

-- ── the link ───────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.drop_orders add column if not exists stop_id uuid references public.stops(id) on delete set null;
create index if not exists drop_orders_stop_id_idx on public.drop_orders (stop_id) where stop_id is not null;

-- ── THE rule: when a pack's drop closes ────────────────────────────────────────────────────────────────────────────
create or replace function public.pack_closes_at(p_day date, p_stop uuid) returns timestamptz
  language sql stable set search_path = public as $$
  select case
           when s.id is not null and s.canceled_at is not null then null          -- called off: it never closes
           when s.id is not null and s.starts_at is not null then s.starts_at - interval '24 hours'
           when p_day is not null then ((p_day - 3)::timestamp + time '18:00') at time zone 'America/New_York'
         end
    from (select 1) one
    left join public.stops s on s.id = p_stop
$$;
-- the signed-in and the server ask it (and the link below, as whoever writes the pack); never PUBLIC or anon (0381)
revoke all on function public.pack_closes_at(date, uuid) from public, anon;
grant execute on function public.pack_closes_at(date, uuid) to authenticated, service_role;

-- Backfill: the day's stop on the schedule (completed stops included — history keeps its stop), the first still taking
-- packs (a pack ordered for the second stop of a day after the first closed was ordered for that one), else the day's
-- first; else one the truck called off. A stop the crew took off the schedule without calling it off (archived) is none.
update public.drop_orders d set stop_id = (
  select s.id from public.stops s
   where s.starts_at is not null and (s.starts_at at time zone 'America/New_York')::date = d.drop_date
     and (s.archived_at is null or s.canceled_at is not null)
   order by (s.canceled_at is not null), (public.pack_closes_at(d.drop_date, s.id) <= now()), s.starts_at
   limit 1)
 where d.stop_id is null and d.drop_date is not null;

-- Every writer: a new pack with no stop, or a pack moved to a day its stop is not on, takes that day's first stop still
-- taking packs, else its first (none: no stop, and the Saturday rule decides when it closes). A pack that moved WITH its
-- stop keeps it.
create or replace function public.link_pack_stop() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.drop_date is not null and (
       (tg_op = 'INSERT' and new.stop_id is null)
    or (tg_op = 'UPDATE' and new.drop_date is distinct from old.drop_date
        and not exists (select 1 from public.stops k
                         where k.id = new.stop_id and (k.starts_at at time zone 'America/New_York')::date = new.drop_date))) then
    new.stop_id := (select s.id from public.stops s
                     where s.starts_at is not null and s.archived_at is null and s.canceled_at is null
                       and (s.starts_at at time zone 'America/New_York')::date = new.drop_date
                     order by (public.pack_closes_at(new.drop_date, s.id) <= now()), s.starts_at limit 1);
  end if;
  return new;
end $$;
drop trigger if exists drop_orders_link_stop on public.drop_orders;
create trigger drop_orders_link_stop before insert or update of drop_date, stop_id on public.drop_orders
  for each row execute function public.link_pack_stop();

-- A stop moved to another day takes its packs (not picked up, not canceled) with it; the crew hear how many.
create or replace function public.stop_moves_its_packs() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_old date; v_new date; v_n int;
begin
  v_old := (old.starts_at at time zone 'America/New_York')::date;
  v_new := (new.starts_at at time zone 'America/New_York')::date;
  if v_new is null or v_old is not distinct from v_new then return new; end if;
  update public.drop_orders set drop_date = v_new
   where stop_id = new.id and canceled_at is null and not picked_up and drop_date is distinct from v_new;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.alerts (severity, category, title, body, link)
    values ('important', 'order', 'Packs moved with their stop',
            v_n || ' pack' || case when v_n = 1 then '' else 's' end || ' for ' || coalesce(new.name, 'a stop') || ' moved from '
              || to_char(v_old, 'Dy Mon DD') || ' to ' || to_char(v_new, 'Dy Mon DD') || ' with it. Let the customers know.',
            '/crew?s=now');
  end if;
  return new;
end $$;
-- existing rows: stop_moves_its_packs — new in this migration; it fires only on a stop's later change of day, never on the backfill.
revoke all on function public.stop_moves_its_packs() from public, anon, authenticated;
drop trigger if exists stops_move_their_packs on public.stops;
create trigger stops_move_their_packs after update of starts_at on public.stops
  for each row execute function public.stop_moves_its_packs();

-- ── a member's own cancel: only while reserved and open ───────────────────────────────────────────────────────────────
create or replace function public.cancel_own_reservation(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.drop_orders%rowtype; v_closes timestamptz;
begin
  select * into r from public.drop_orders
    where id = p_id and user_id = (select auth.uid())
    for update;
  if r.id is null or r.canceled_at is not null or r.picked_up then return false; end if;
  if r.collected_at is not null then return false; end if;  -- paid at the window (0341): the crew cancels it
  -- 0397: preparing, ready or on its way is the crew's — and so is a pack whose drop has closed.
  if coalesce(r.stage, 'reserved') <> 'reserved' then return false; end if;
  v_closes := public.pack_closes_at(r.drop_date, r.stop_id);
  if v_closes is not null and now() >= v_closes then return false; end if;
  update public.drop_orders set canceled_at = now() where id = p_id;
  if r.paid then
    insert into public.alerts (severity, category, title, body, link) values (
      'critical', 'money', 'Member canceled a PAID reservation — refund needed',
      r.name || ' · ' || r.size || '-pack · $' || to_char(r.total_cents / 100.0, 'FM999990.00')
        || ' for ' || to_char(r.drop_date, 'Dy Mon DD') || '''s drop. Refund it in Square.',
      '/admin?s=now');
  end if;
  return true;
end $$;
-- existing rows: cancel_own_reservation — the same alert as 0341 wrote; this migration adds refusals, never a new alert.
-- as 0381 left it: the signed-in person's own (it checks the pack is theirs), and the server's; never PUBLIC or anon
revoke execute on function public.cancel_own_reservation(uuid) from public, anon;
grant execute on function public.cancel_own_reservation(uuid) to authenticated, service_role;

-- ── a stop called off counts its own packs ──────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_stop(p_stop uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s public.stops%rowtype; v_day date; v_cups int; v_packs int; v_other int; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'owners and admins only' using errcode = '42501'; end if;
  if v_reason is not null and char_length(v_reason) > 140 then raise exception 'keep the reason to 140 characters' using errcode = '22001'; end if;
  select * into s from public.stops where id = p_stop for update;
  if s.id is null then return null; end if;
  if s.canceled_at is null then
    update public.stops
       set canceled_at = now(), cancel_reason = v_reason, archived_at = coalesce(archived_at, now()),
           status = case when status = 'live' then 'upcoming' else status end
     where id = p_stop;
  end if;
  v_day := (s.starts_at at time zone 'America/New_York')::date;
  select count(*) into v_cups from public.orders o where o.stop_id = p_stop and o.status in ('new', 'preparing', 'ready');
  select count(*) into v_other from public.stops x
   where x.id <> p_stop and x.archived_at is null and x.canceled_at is null and x.starts_at is not null
     and (x.starts_at at time zone 'America/New_York')::date = v_day;
  -- 0397: the packs for this stop; a pack not linked to a stop is this one's only when no other stop is left that day.
  select count(*) into v_packs from public.drop_orders d
   where d.canceled_at is null and not d.picked_up
     and (d.stop_id = p_stop or (d.stop_id is null and v_day is not null and v_other = 0 and d.drop_date = v_day));
  return jsonb_build_object('day', v_day, 'cups', v_cups, 'packs', v_packs, 'other_stop_that_day', v_other > 0, 'already', s.canceled_at is not null);
end $$;
revoke all on function public.cancel_stop(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_stop(uuid, text) to authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A pack knows its stop', 'fix', 'Ordering',
   'A pack is picked up at a stop, and now it is recorded at one. A stop moved to another day takes its packs along; a stop called off leaves them open to move or cancel; and a pack can be canceled only until 24 hours before its stop, while it is still just reserved.',
   '2026-10-13', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0397_a_pack_belongs_to_its_stop');

-- verify (numbers and booleans only):
--   select count(*) from information_schema.columns where table_name = 'drop_orders' and column_name = 'stop_id';          -- 1
--   select count(*) from pg_trigger where tgname in ('drop_orders_link_stop', 'stops_move_their_packs');                      -- 2
--   select count(*) from public.drop_orders where stop_id is null and drop_date >= current_date and canceled_at is null;      -- packs with no stop that day
