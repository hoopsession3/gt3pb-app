-- ── 0399 — A PACK HEARS ABOUT ITS DAY ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-14 (R5 of the customer audit — "A pickup-day text, plus notices when a pack is moved or cancelled"; decided
-- 2026-10-13: texts with a recorded opt-in, STOP honoured, no texts at night).
--
-- WHY. A pack is reserved days ahead and picked up at a stop on a day. Nothing reminded anyone the evening before. When
-- the crew moved a pack to another drop (the drop board's "next week"), moved a stop's hours or place, or canceled a
-- pack, the member heard nothing; when a stop moved to another day its packs moved with it (0397) and the crew got an
-- alert asking them to "let the customers know" — by hand, one by one.
--
-- WHAT.
--   · pack_notices — what a member is told about their pack, one row per notice: the evening-before reminder
--     (pickup_tomorrow), the stop's hours or place changed (pickup_changed), the crew moved the pack (pack_moved) or
--     canceled it (pack_canceled). When it is due, when it went, and what went (filled in by the push function).
--   · the crew's change tells the member: a pack the crew moves or cancels, and a stop whose hours or place the crew
--     change, queue a notice. The member's own change (their routes run as the server) says nothing — they made it —
--     and a stop called off tells its people itself (app/api/crew/stops/cancel). A second change before a notice goes
--     out moves its time; the words are read when it goes, so they are the latest.
--   · release_pack_notices(now) — every five minutes (pg_cron): from 6pm Eastern, the evening-before reminder for
--     each pack picked up tomorrow, once for that day; then what is due goes — from 8am to 9pm Eastern only: a notice
--     due at night waits for the morning. A notice about a pack since canceled, picked up or moved off its day is let
--     go; one undelivered for three days is dropped; a sent one is kept sixty days.
--   · the door: a notice marked sent is handed to the push function (supabase/functions/push, table pack_notices),
--     which pushes it to the member's devices, emails it, and texts it when texts are on and the number said yes
--     (0398). The trigger is made from the call the alert fan-out already makes, as 0394 made the reminders' — so
--     this file carries no address and no key. No fan-out found: no trigger, said in a notice.
--   · a stop moved to another day (0397's stop_moves_its_packs) tells its packs instead of asking the crew to.
--
-- ORDER: deploy the push function first (supabase/functions/push — index.ts and policy.ts), then paste this. A push
-- function from before this file skips a table it does not know, so a notice marked sent before it is deployed is lost.
--
-- A second run changes nothing.

create table if not exists public.pack_notices (
  id          uuid primary key default gen_random_uuid(),
  pack_id     uuid not null references public.drop_orders (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('pickup_tomorrow', 'pickup_changed', 'pack_moved', 'pack_canceled')),
  for_day     date,                         -- the pickup day an evening-before reminder is about
  due_at      timestamptz not null,
  sent_at     timestamptz,
  pushed      integer,                      -- devices it was sent to
  emailed     boolean,
  texted      text check (texted in ('sent', 'off', 'not-asked', 'quiet', 'no-number', 'failed')),
  detail      text,
  created_at  timestamptz not null default now()
);
-- One notice waiting per pack and kind (a second change moves its time); one reminder per pack and pickup day.
create unique index if not exists pack_notices_one_waiting on public.pack_notices (pack_id, kind)
  where sent_at is null and kind <> 'pickup_tomorrow';
create unique index if not exists pack_notices_one_reminder on public.pack_notices (pack_id, for_day)
  where kind = 'pickup_tomorrow';
create index if not exists pack_notices_due on public.pack_notices (due_at) where sent_at is null;
comment on table public.pack_notices is
  'A pack hears about its day (0399): the evening-before reminder, and the crew''s moves, cancels and stop changes — when each is due, when it went, and what went (push, email, text).';

alter table public.pack_notices enable row level security;
revoke all on public.pack_notices from public, anon, authenticated;
-- the server's alone: nothing reads or writes these from a phone's page

-- ── queue one ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.queue_pack_notice(p_pack uuid, p_kind text, p_due timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into public.pack_notices (pack_id, user_id, kind, due_at)
  select d.id, d.user_id, p_kind, p_due from public.drop_orders d where d.id = p_pack and d.user_id is not null
  on conflict (pack_id, kind) where sent_at is null and kind <> 'pickup_tomorrow'
  do update set due_at = excluded.due_at
$$;
revoke all on function public.queue_pack_notice(uuid, text, timestamptz) from public, anon, authenticated;

-- ── the crew's change to a pack tells its member ──────────────────────────────────────────────────────────────────
create or replace function public.pack_change_tells_its_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_by uuid := auth.uid();
begin
  -- canceled or picked up, by anyone: nothing more goes out about it but the cancel itself (queued below)
  if (new.canceled_at is not null and old.canceled_at is null)
     or (coalesce(new.picked_up, false) and not coalesce(old.picked_up, false))
     or (new.collected_at is not null and old.collected_at is null) then
    delete from public.pack_notices where pack_id = new.id and sent_at is null;
  end if;
  -- the member's own change (their routes run as the server, or it is theirs) and a stop's (it tells them itself)
  if v_by is null or new.user_id is null or v_by = new.user_id
     or coalesce(current_setting('gt3.pack_follows_stop', true), '') = 'on' then
    return null;
  end if;
  if new.canceled_at is not null and old.canceled_at is null then
    perform public.queue_pack_notice(new.id, 'pack_canceled', now());
  elsif new.canceled_at is null and not coalesce(new.picked_up, false) and new.collected_at is null
        and (new.drop_date is distinct from old.drop_date or new.stop_id is distinct from old.stop_id) then
    perform public.queue_pack_notice(new.id, 'pack_moved', now() + interval '2 minutes');
  end if;
  return null;
end $$;
revoke all on function public.pack_change_tells_its_member() from public, anon, authenticated;
drop trigger if exists drop_orders_tell_member on public.drop_orders;
create trigger drop_orders_tell_member after update of drop_date, stop_id, canceled_at, picked_up, collected_at on public.drop_orders
  for each row execute function public.pack_change_tells_its_member();

-- ── a stop's hours or place changed: its packs hear it ────────────────────────────────────────────────────────────
-- A place counts as changed when its words do, not its commas: "202 Scuffletown Rd." and "202 Scuffletown Rd" are one.
create or replace function public.stop_change_tells_its_packs()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_place_old text := regexp_replace(lower(coalesce(old.address, '') || '|' || coalesce(old.location_text, '')), '[^a-z0-9|]', '', 'g');
  v_place_new text := regexp_replace(lower(coalesce(new.address, '') || '|' || coalesce(new.location_text, '')), '[^a-z0-9|]', '', 'g');
begin
  if new.canceled_at is not null or new.archived_at is not null then return null; end if;   -- called off: it says so itself
  if new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at
     and v_place_new = v_place_old then
    return null;
  end if;
  if coalesce(new.ends_at, new.starts_at) is not null and coalesce(new.ends_at, new.starts_at) < now() then return null; end if;
  insert into public.pack_notices (pack_id, user_id, kind, due_at)
  select d.id, d.user_id, 'pickup_changed', now() + interval '5 minutes'
    from public.drop_orders d
   where d.stop_id = new.id and d.user_id is not null and d.canceled_at is null
     and not coalesce(d.picked_up, false) and d.collected_at is null
  on conflict (pack_id, kind) where sent_at is null and kind <> 'pickup_tomorrow'
  do update set due_at = excluded.due_at;
  -- the stop says it now: a "your pack moved" still waiting about the same packs would say less
  delete from public.pack_notices n using public.drop_orders d
   where n.pack_id = d.id and d.stop_id = new.id and n.kind = 'pack_moved' and n.sent_at is null;
  return null;
end $$;
revoke all on function public.stop_change_tells_its_packs() from public, anon, authenticated;
drop trigger if exists stops_tell_their_packs on public.stops;
create trigger stops_tell_their_packs after update of starts_at, ends_at, address, location_text on public.stops
  for each row execute function public.stop_change_tells_its_packs();

-- A stop moved to another day takes its packs with it (0397) — and now they hear it from the stop (pickup_changed,
-- above), so the crew are told that, not asked to call round. The packs' own trigger stays quiet while they follow.
create or replace function public.stop_moves_its_packs() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_old date; v_new date; v_n int;
begin
  v_old := (old.starts_at at time zone 'America/New_York')::date;
  v_new := (new.starts_at at time zone 'America/New_York')::date;
  if v_new is null or v_old is not distinct from v_new then return new; end if;
  perform set_config('gt3.pack_follows_stop', 'on', true);
  update public.drop_orders set drop_date = v_new
   where stop_id = new.id and canceled_at is null and not picked_up and drop_date is distinct from v_new;
  get diagnostics v_n = row_count;
  perform set_config('gt3.pack_follows_stop', '', true);
  if v_n > 0 then
    insert into public.alerts (severity, category, title, body, link)
    values ('important', 'order', 'Packs moved with their stop',
            v_n || ' pack' || case when v_n = 1 then '' else 's' end || ' for ' || coalesce(new.name, 'a stop') || ' moved from '
              || to_char(v_old, 'Dy Mon DD') || ' to ' || to_char(v_new, 'Dy Mon DD') || ' with it. '
              || case when v_n = 1 then 'Its member is' else 'Each member is' end || ' told by push and email (and text, where they said yes).',
            '/crew?s=now');
  end if;
  return new;
end $$;
revoke all on function public.stop_moves_its_packs() from public, anon, authenticated;
-- existing rows: stop_moves_its_packs — the alerts it already wrote asked the crew to let the customers know, and those
-- members were told by hand or not at all: they stand as written. Only a stop moved from now on says its members are told.

-- ── the five minutes' run ──────────────────────────────────────────────────────────────────────────────────────────
-- Only the cron runs it (and the owner, from the SQL editor). p_now is for the tests; the cron passes nothing.
create or replace function public.release_pack_notices(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hour  int  := extract(hour from (p_now at time zone 'America/New_York'));
  v_today date := (p_now at time zone 'America/New_York')::date;
  v_n     int;
begin
  -- 1 · the evening before: from 6pm, each pack picked up tomorrow gets its reminder — once for that day
  if v_hour >= 18 and v_hour < 21 then
    insert into public.pack_notices (pack_id, user_id, kind, for_day, due_at)
    select d.id, d.user_id, 'pickup_tomorrow', d.drop_date, p_now
      from public.drop_orders d
      left join public.stops s on s.id = d.stop_id
     where d.drop_date = v_today + 1 and d.user_id is not null and d.canceled_at is null
       and not coalesce(d.picked_up, false) and d.collected_at is null
       and (s.id is null or (s.canceled_at is null and s.archived_at is null))
    on conflict (pack_id, for_day) where kind = 'pickup_tomorrow' do nothing;
  end if;

  -- 2 · let go of what no longer holds: a pack since canceled (but its cancel), picked up, moved off the reminder's day,
  --     past its day, or at a stop since called off (it tells its people itself)
  delete from public.pack_notices n
   where n.sent_at is null
     and exists (select 1 from public.drop_orders d left join public.stops s on s.id = d.stop_id
                  where d.id = n.pack_id
                    and ((n.kind <> 'pack_canceled' and (d.canceled_at is not null or coalesce(d.picked_up, false) or d.collected_at is not null))
                         or (n.kind <> 'pack_canceled' and d.drop_date < v_today)
                         or (n.kind = 'pickup_tomorrow' and n.for_day is distinct from d.drop_date)
                         or (n.kind in ('pickup_tomorrow', 'pickup_changed') and s.canceled_at is not null)));
  delete from public.pack_notices where sent_at is null and due_at < p_now - interval '3 days';
  delete from public.pack_notices where sent_at < p_now - interval '60 days';

  -- 3 · nothing goes out at night (9pm to 8am Eastern): it waits for the morning
  if v_hour < 8 or v_hour >= 21 then return 0; end if;
  update public.pack_notices set sent_at = p_now where sent_at is null and due_at <= p_now;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.release_pack_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.release_pack_notices(timestamptz) to service_role;

do $$ begin
  perform cron.unschedule('release-pack-notices');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('release-pack-notices', '*/5 * * * *', 'select public.release_pack_notices()');
exception when others then raise notice '0399: pg_cron is not here, so pack notices are not sent on their own — run select public.release_pack_notices() to send what is due.';
end $$;

-- ── the door to the push function ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
  v_def  text;
  v_call text;
begin
  select t.tgname, pg_get_triggerdef(t.oid)
    into v_name, v_def
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace s on s.oid = p.pronamespace
   where t.tgrelid = 'public.alerts'::regclass
     and not t.tgisinternal
     and s.nspname = 'supabase_functions' and p.proname = 'http_request'
     and (t.tgtype & 4) = 4                              -- it fires on INSERT
     and t.tgname <> 'alerts_push_escalation'
   order by (t.tgname = 'alerts_push_fanout') desc, t.tgname
   limit 1;

  v_call := substring(coalesce(v_def, '') from 'EXECUTE (?:FUNCTION|PROCEDURE) .*$');
  if v_call is null then
    raise notice '0399: nothing on public.alerts hands a new alert to supabase_functions.http_request, so a pack notice has no way to the push function — none made.';
    return;
  end if;

  execute 'drop trigger if exists pack_notices_push on public.pack_notices';
  execute 'create trigger pack_notices_push after update of sent_at on public.pack_notices for each row '
       || 'when (old.sent_at is null and new.sent_at is not null) '
       || v_call;
  raise notice '0399: a pack notice goes through %''s call, as every new alert does.', v_name;
end $$;

-- existing rows: none — pack_notices is new in this migration; the triggers fire only on later changes, and the first
-- evening-before reminders are made by the run on the evening before a pickup.

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Your pack, the evening before', 'feature', 'Packs',
   'The evening before pickup we remind you where and when. If we move your pack, change your stop''s hours or place, or cancel it, you hear it from us — by push and email, and by text if you said yes. Nothing goes out at night.',
   '2026-10-14', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0399_a_pack_hears_about_its_day');

-- verify (numbers and booleans only):
--   select count(*) from information_schema.tables where table_name = 'pack_notices';                                     -- 1
--   select count(*) from pg_trigger where tgname in ('drop_orders_tell_member', 'stops_tell_their_packs', 'pack_notices_push'); -- 3
--   select count(*) from cron.job where jobname = 'release-pack-notices';                                                 -- 1
--   select has_function_privilege('authenticated', 'public.release_pack_notices(timestamptz)', 'execute');                -- false
