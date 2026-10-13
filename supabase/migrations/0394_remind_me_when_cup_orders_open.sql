-- ── 0394 — REMIND ME WHEN CUP ORDERS OPEN ──────────────────────────────────────────────────────────────────────────────
-- 2026-10-13 (R3 of the customer audit, board 04 "Truck's off — it says so, and when it's back", approved 2026-10-12).
--
-- WHY. With the truck off, Today said nothing about it, and "Order again" opened a checkout that said it was closed. Now
-- Today leads with the next stop and when cup orders open ("Cup orders open Sat at 5:00am"), and offers one thing to do
-- about it: "Remind me at 5:00am" — a push to the member's phone when that stop's window opens. Nothing could do that:
-- the only customer push is the go-live ping (0257), which waits for the switch, and a stop's window opens by the clock
-- (start − lead, lib/ordering) with nothing written anywhere.
--
-- WHAT.
--   · cup_reminders — one row per member and stop: when to remind (the window's opening, as the phone computed it from
--     the rule it shows), and when it was sent. A member reads their own (the button says "Reminder set"); writing goes
--     through the two functions below, which check the stop.
--   · keep_cup_reminder(stop, at) / drop_cup_reminder(stop) — set and take back. A reminder is for a stop that is still
--     on (not archived, not called off), at a time between now and the stop's start; anything else is refused in words.
--   · fire_cup_reminders() — every minute (pg_cron): a reminder whose time has come, for a stop still on, is marked
--     sent; one more than half an hour late is let go rather than sent late (a window long open is not news); a week
--     after, the row goes.
--   · the door: marking one sent hands the row to the push function (supabase/functions/push, table cup_reminders),
--     which sends it to that member's devices. The trigger is made from the call the alert fan-out already makes —
--     the same function with the same arguments, read from the database, as 0380 made the escalation's — so this file
--     carries no address and no key. No fan-out found: no trigger, said in a notice, and reminders are marked but not
--     sent (the button is shown only where a push can land, and the push function must know this table: deploy it).
--
-- A second run changes nothing.

create table if not exists public.cup_reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  stop_id    uuid not null references public.stops (id) on delete cascade,
  remind_at  timestamptz not null,
  fired_at   timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, stop_id)
);
create index if not exists cup_reminders_due on public.cup_reminders (remind_at) where fired_at is null;
comment on table public.cup_reminders is
  'Remind me when cup orders open (0394): a member, a stop, when its window opens (remind_at) and when the push went (fired_at).';

alter table public.cup_reminders enable row level security;
drop policy if exists cup_reminders_own_read on public.cup_reminders;
create policy cup_reminders_own_read on public.cup_reminders for select to authenticated using (user_id = auth.uid());
revoke all on public.cup_reminders from anon, authenticated;
grant select on public.cup_reminders to authenticated;

-- ── set and take back ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.keep_cup_reminder(p_stop uuid, p_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_stop record;
begin
  if v_user is null then
    raise exception 'Sign in to be reminded.' using errcode = '42501';
  end if;
  select id, starts_at, archived_at, canceled_at into v_stop from public.stops where id = p_stop;
  if v_stop.id is null or v_stop.archived_at is not null or v_stop.canceled_at is not null then
    raise exception 'That stop isn''t on the calendar any more.' using errcode = 'PT404';   -- a 4xx, never a 5xx (0360)
  end if;
  if p_at is null or p_at < now() - interval '5 minutes' or p_at > now() + interval '14 days'
     or (v_stop.starts_at is not null and p_at > v_stop.starts_at) then
    raise exception 'Cup orders for that stop don''t open then.' using errcode = '22023';
  end if;
  insert into public.cup_reminders as r (user_id, stop_id, remind_at)
  values (v_user, p_stop, greatest(p_at, now()))
  on conflict (user_id, stop_id) do update set remind_at = excluded.remind_at, fired_at = null;
  return greatest(p_at, now());
end $$;
revoke all on function public.keep_cup_reminder(uuid, timestamptz) from public;
grant execute on function public.keep_cup_reminder(uuid, timestamptz) to authenticated;

create or replace function public.drop_cup_reminder(p_stop uuid)
returns boolean language sql security definer set search_path = public as $$
  with gone as (delete from public.cup_reminders where user_id = auth.uid() and stop_id = p_stop returning 1)
  select exists (select 1 from gone)
$$;
revoke all on function public.drop_cup_reminder(uuid) from public;
grant execute on function public.drop_cup_reminder(uuid) to authenticated;

-- ── the minute's run ───────────────────────────────────────────────────────────────────────────────────────────────
-- Only the cron runs it (and the owner, from the SQL editor): no app role may call it.
create or replace function public.fire_cup_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.cup_reminders r set fired_at = now()
   where r.fired_at is null
     and r.remind_at <= now()
     and r.remind_at > now() - interval '30 minutes'
     and exists (select 1 from public.stops s where s.id = r.stop_id and s.archived_at is null and s.canceled_at is null);
  get diagnostics v_n = row_count;
  delete from public.cup_reminders where remind_at < now() - interval '7 days';
  return v_n;
end $$;
revoke all on function public.fire_cup_reminders() from public, anon, authenticated;
grant execute on function public.fire_cup_reminders() to service_role;

do $$ begin
  perform cron.unschedule('fire-cup-reminders');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('fire-cup-reminders', '* * * * *', 'select public.fire_cup_reminders()');
exception when others then raise notice '0394: pg_cron is not here, so reminders are not sent on their own — run select public.fire_cup_reminders() to send what is due.';
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
    raise notice '0394: nothing on public.alerts hands a new alert to supabase_functions.http_request, so a reminder has no way to the push function — none made.';
    return;
  end if;

  execute 'drop trigger if exists cup_reminders_push on public.cup_reminders';
  execute 'create trigger cup_reminders_push after update of fired_at on public.cup_reminders for each row '
       || 'when (old.fired_at is null and new.fired_at is not null) '
       || v_call;
  raise notice '0394: a reminder goes through %''s call, as every new alert does.', v_name;
end $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Today says what the truck is doing', 'feature', 'Ordering',
   'Today leads with what is true now: an order being made, with its number and where it is; the truck pouring, with your usual one tap from a priced checkout; or the truck off, with the next stop, its hours and when cup orders open — and a reminder for that moment on your phone.',
   '2026-10-13', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0394_remind_me_when_cup_orders_open');

-- verify:
--   select count(*) from information_schema.tables where table_name = 'cup_reminders';                       -- 1
--   select count(*) from pg_proc where proname in ('keep_cup_reminder', 'drop_cup_reminder', 'fire_cup_reminders');  -- 3
--   select count(*) from cron.job where jobname = 'fire-cup-reminders';                                       -- 1
--   select count(*) from pg_trigger where tgname = 'cup_reminders_push';                                      -- 1
