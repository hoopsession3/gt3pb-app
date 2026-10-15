-- ── 0405 — A WEEK'S AUDIT IS A RECORD ─────────────────────────────────────────────────────────────────────────────────
-- 2026-10-15. Release 3 of the Today, Command, Audit & Catalog audit, "the audit as a record" — the first of the crew's
-- database rules, one yes and one migration each (Ryan, 2026-10-15: "Crew database rules"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. The Monday Audit (components/MondayAudit, the walk since 2026-10-12) is the portfolio's history, and the database
-- kept it like a notepad:
--   · it filed each audit under the phone's day (week_of = localToday()), not the week's Monday: a Monday audit and a
--     Tuesday fix were two rows, and the two-week rule, which counts weeks, counted two;
--   · it saved in two writes — the history row, then the stream's health and date — so a second write that failed left
--     the history moved and the screen not;
--   · a second save the same day overwrote a colleague's audit without a word, and any owner or admin could rewrite or
--     delete any week's audit, last month's included (0264's "ws audits admin write", for all);
--   · removing a stream deleted its whole history with it (on delete cascade).
--
-- WHAT.
--   · audit_week(day) — the Monday of the business's week: Eastern, business_day() (0348), as the walk's weekStartKey.
--   · The history re-filed: each audit under its week's Monday. Where one week holds two, the later is that week's audit
--     and the earlier is kept, not lost, in workstream_audit_superseded.
--   · save_workstream_audit(...) — the one writer of an audit, an owner's or an admin's. The week's row (when all five are
--     scored) and the stream (its details, and with a score its health and the day it was audited) in one transaction:
--     both, or neither. It refuses, in words, a save over a change the caller has not seen (os_workstreams.updated_at,
--     new here): a colleague's newer save is never overwritten without being read.
--   · A week that has ended cannot change: the API roles write no audit row directly any more (the function does), and a
--     trigger refuses any change to a week before this one, whoever asks — the function included.
--   · A stream with history cannot be deleted (on delete restrict). Park it: parking keeps it and its record.
--   · v_workstream_weeks — each stream's last eight weekly totals, for the list's history and the walk's "was".
--   · The reminder: on a Monday at 9 am Eastern, each owner and admin gets one "Monday audit" alert while any active stream
--     is unscored this week; it clears itself when the last one is saved (save_workstream_audit), and reaches nobody else.
--
-- UNCHANGED: the five criteria and their 0–2 scale, the total and its bands, the two-week rule and its words, who may
-- audit (owners and admins), who may read (all staff), and the details a stream carries.
-- changelog: below.

-- ── the week ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.audit_week(p_day date default public.business_day()) returns date
  language sql immutable set search_path = public as $$
  select p_day - (extract(isodow from p_day)::int - 1)
$$;
comment on function public.audit_week(date) is
  'The Monday of the week a day falls in — the week an audit is filed under (0405). With no day, this business week''s Monday (Eastern, business_day()).';

-- ── the history, re-filed by week ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.workstream_audit_superseded (
  id            uuid primary key,
  workstream_id uuid not null,
  week_of       date not null,           -- the day it was filed under before 0405
  c_owner       smallint,
  c_next        smallint,
  c_blockers    smallint,
  c_artifacts   smallint,
  c_signal      smallint,
  total         int,
  note          text,
  audited_by    uuid,
  created_at    timestamptz,
  superseded_at timestamptz not null default now()
);
alter table public.workstream_audit_superseded enable row level security;
drop policy if exists "ws audits superseded staff read" on public.workstream_audit_superseded;
create policy "ws audits superseded staff read" on public.workstream_audit_superseded for select using ((select public.is_staff()));
revoke all on public.workstream_audit_superseded from anon;
grant select on public.workstream_audit_superseded to authenticated;
comment on table public.workstream_audit_superseded is
  'An audit that 0405 found sharing a week with a later one: kept as it was, under the day it was filed, when the history was re-filed by Monday. Read only; nothing writes here after 0405.';

-- The lock below would refuse moving a past week's row; it does not exist yet on a first run, and on a second there is
-- nothing left to move.
drop trigger if exists workstream_audit_week_is_closed on public.workstream_audits;

with ranked as (
  select a.*, row_number() over (partition by a.workstream_id, public.audit_week(a.week_of)
                                 order by a.week_of desc, a.created_at desc, a.id desc) as rn
    from public.workstream_audits a
)
insert into public.workstream_audit_superseded (id, workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by, created_at)
select id, workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by, created_at
  from ranked where rn > 1
on conflict (id) do nothing;

delete from public.workstream_audits a
 using public.workstream_audit_superseded s
 where s.id = a.id;

update public.workstream_audits
   set week_of = public.audit_week(week_of)
 where week_of <> public.audit_week(week_of);

-- ── the stream says when it last changed ──────────────────────────────────────────────────────────────────────────────
alter table public.os_workstreams add column if not exists updated_at timestamptz not null default now();
drop trigger if exists os_workstreams_touch on public.os_workstreams;
create trigger os_workstreams_touch before update on public.os_workstreams
  for each row execute function public.touch_updated_at();

-- ── a stream with a record is parked, not deleted ─────────────────────────────────────────────────────────────────────
alter table public.workstream_audits drop constraint if exists workstream_audits_workstream_id_fkey;
alter table public.workstream_audits add constraint workstream_audits_workstream_id_fkey
  foreign key (workstream_id) references public.os_workstreams(id) on delete restrict;

-- ── a week that has ended cannot change ───────────────────────────────────────────────────────────────────────────────
create or replace function public.workstream_audit_week_is_closed() returns trigger
  language plpgsql set search_path = public as $$
declare
  this_week date := public.audit_week(public.business_day());
begin
  if tg_op in ('UPDATE', 'DELETE') and old.week_of < this_week then
    raise exception 'week_closed' using errcode = '42501',
      detail = 'An audit cannot change once its week has ended. This week''s audit is the place for what changed.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.week_of <> public.audit_week(new.week_of) then
      raise exception 'not_a_week' using errcode = '22023', detail = 'An audit is filed under its week''s Monday.';
    end if;
    if new.week_of < this_week then
      raise exception 'week_closed' using errcode = '42501',
        detail = 'An audit cannot be filed under a week that has ended.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger workstream_audit_week_is_closed before insert or update or delete on public.workstream_audits
  for each row execute function public.workstream_audit_week_is_closed();

-- The API roles read the history and write none of it: save_workstream_audit is the writer.
drop policy if exists "ws audits admin write" on public.workstream_audits;
revoke insert, update, delete on public.workstream_audits from anon, authenticated;

-- ── the one writer ────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_seen: the stream's updated_at as the caller read it (null skips the check — the walk always sends it).
-- p_details: { name, owner, owner_user_id, status, next_action, due, blocker } — what the walk's form holds.
-- p_scores: { c_owner, c_next, c_blockers, c_artifacts, c_signal }, all five 0–2, or null for a details-only save.
-- Answers { ok: true, week_of, total, updated_at } or { ok: false, code, words } — 'changed' (someone saved this stream
-- after the caller read it), 'no_stream', 'bad_scores', 'bad_details'. A caller who is not an owner or an admin is
-- refused with an error, as every admin-only function here is.
create or replace function public.save_workstream_audit(
  p_workstream uuid,
  p_seen timestamptz,
  p_details jsonb,
  p_scores jsonb default null,
  p_note text default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  w        public.os_workstreams%rowtype;
  wk       date := public.audit_week(public.business_day());
  v_name   text := btrim(coalesce(p_details->>'name', ''));
  v_status text := coalesce(nullif(p_details->>'status', ''), 'active');
  v_due    date;
  v_owner_id uuid;
  k        text;
  v        int;
  total    int := 0;
  stamp    timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501', detail = 'The Monday audit is an owner''s or an admin''s.';
  end if;

  select * into w from public.os_workstreams where id = p_workstream for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_stream', 'words', 'This stream is no longer in the portfolio.');
  end if;
  if p_seen is not null and w.updated_at is distinct from p_seen then
    return jsonb_build_object('ok', false, 'code', 'changed', 'updated_at', w.updated_at,
      'words', 'Someone saved this stream after you opened it. Check what they changed, then save again to keep yours.');
  end if;

  if v_name = '' or v_status not in ('active', 'blocked', 'parked') then
    return jsonb_build_object('ok', false, 'code', 'bad_details', 'words', 'A stream needs a name, and a status of active, blocked or parked.');
  end if;
  begin
    v_due := nullif(p_details->>'due', '')::date;
    v_owner_id := nullif(p_details->>'owner_user_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'bad_details', 'words', 'The due date or the owner could not be read.');
  end;

  if p_scores is not null then
    foreach k in array array['c_owner', 'c_next', 'c_blockers', 'c_artifacts', 'c_signal'] loop
      v := case when jsonb_typeof(p_scores->k) = 'number' then (p_scores->>k)::int end;
      if v is null or v not in (0, 1, 2) then
        return jsonb_build_object('ok', false, 'code', 'bad_scores', 'words', 'All five scores, each 0, 1 or 2 — or none, to save the details alone.');
      end if;
      total := total + v;
    end loop;

    insert into public.workstream_audits (workstream_id, week_of, c_owner, c_next, c_blockers, c_artifacts, c_signal, total, note, audited_by)
    values (p_workstream, wk, (p_scores->>'c_owner')::int, (p_scores->>'c_next')::int, (p_scores->>'c_blockers')::int,
            (p_scores->>'c_artifacts')::int, (p_scores->>'c_signal')::int, total, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (workstream_id, week_of) do update
       set c_owner = excluded.c_owner, c_next = excluded.c_next, c_blockers = excluded.c_blockers,
           c_artifacts = excluded.c_artifacts, c_signal = excluded.c_signal, total = excluded.total,
           note = excluded.note, audited_by = excluded.audited_by;
  end if;

  update public.os_workstreams
     set name = left(v_name, 80),
         owner = left(btrim(coalesce(p_details->>'owner', '')), 40),
         owner_user_id = v_owner_id,
         status = v_status,
         next_action = nullif(btrim(coalesce(p_details->>'next_action', '')), ''),
         due = v_due,
         blocker = nullif(btrim(coalesce(p_details->>'blocker', '')), ''),
         health = case when p_scores is null then health else total end,
         last_audited = case when p_scores is null then last_audited else public.business_day() end
   where id = p_workstream
  returning updated_at into stamp;

  -- The last stream scored this week clears the week's reminder for everyone it reached.
  if p_scores is not null and not exists (
       select 1 from public.os_workstreams s
        where s.status <> 'parked'
          and not exists (select 1 from public.workstream_audits a where a.workstream_id = s.id and a.week_of = wk)) then
    update public.alerts set ack_at = now(), ack_by = auth.uid()
     where kind = 'monday_audit_due' and ack_at is null;
  end if;

  return jsonb_build_object('ok', true, 'week_of', wk, 'total', case when p_scores is null then null else total end, 'updated_at', stamp);
end $$;
comment on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) is
  'The Monday audit''s one writer (0405): the week''s audit row and the stream together, or neither; filed under this week''s Monday (Eastern); refused with code ''changed'' over a save the caller has not seen. An owner''s or an admin''s.';
revoke all on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_workstream_audit(uuid, timestamptz, jsonb, jsonb, text) to authenticated;

-- ── eight weeks a stream ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace view public.v_workstream_weeks with (security_invoker = on) as
select workstream_id, week_of, total
  from (select a.workstream_id, a.week_of, a.total,
               row_number() over (partition by a.workstream_id order by a.week_of desc) as rn
          from public.workstream_audits a) x
 where rn <= 8;
revoke all on public.v_workstream_weeks from anon;
grant select on public.v_workstream_weeks to authenticated;
comment on view public.v_workstream_weeks is
  'Each stream''s last eight weekly audit totals, newest first (0405): the list''s history and the walk''s "was".';

-- ── the Monday reminder ───────────────────────────────────────────────────────────────────────────────────────────────
-- Hourly on Mondays (UTC), acting only in the 9 am Eastern hour, so daylight saving moves nothing. One alert per owner
-- and admin, while any active or blocked stream is unscored this week — the database's own dedupe (0372) counts a second
-- raise instead of sending it — and none at all once the week is scored.
create or replace function public.monday_audit_reminder(p_force boolean default false) returns int
  language plpgsql security definer set search_path = public as $$
declare
  wk     date := public.audit_week(public.business_day());
  due    int;
  person record;
  n      int := 0;
begin
  if not p_force and (extract(isodow from (now() at time zone 'America/New_York')) <> 1
                      or extract(hour from (now() at time zone 'America/New_York')) <> 9) then
    return 0;
  end if;
  select count(*) into due from public.os_workstreams s
   where s.status <> 'parked'
     and not exists (select 1 from public.workstream_audits a where a.workstream_id = s.id and a.week_of = wk);
  -- Last week's, if nobody cleared it, is last week's: it goes, and this week's says this week's count.
  update public.alerts set ack_at = now()
   where kind = 'monday_audit_due' and ack_at is null and created_at < (wk::timestamp at time zone 'America/New_York');
  if due = 0 then return 0; end if;
  for person in select p.id, p.tenant_id from public.profiles p where p.role in ('owner', 'admin') loop
    insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
    values ('important', 'task', 'monday_audit_due', person.id,
            'Monday audit: ' || due || ' stream' || case when due = 1 then '' else 's' end || ' to score',
            'This week''s audit is open. Each stream gets its five scores, its next action and its blocker; the reminder clears when the last one is saved.',
            '/crew?s=command&a=os-registry', person.id, person.tenant_id);
    n := n + 1;
  end loop;
  return n;
end $$;
-- existing rows: monday_audit_reminder — a new producer; it has never written an alert.
revoke all on function public.monday_audit_reminder(boolean) from public, anon, authenticated;
grant execute on function public.monday_audit_reminder(boolean) to service_role;

do $$ begin
  perform cron.unschedule('monday-audit-reminder');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('monday-audit-reminder', '5 * * * 1', 'select public.monday_audit_reminder()');
exception when others then raise notice '0405: pg_cron is not here, so no Monday reminder is raised on its own — run select public.monday_audit_reminder(true) by hand.';
end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A week''s audit is a record', 'improvement', 'Command',
   'The Monday audit files under the week''s Monday, saves the audit and the stream together, never overwrites a colleague''s newer save, and a past week can''t be changed. A stream with history is parked, not deleted. Owners and admins get one Monday reminder that clears when the week is scored.',
   '2026-10-15', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select count(*) from public.workstream_audits where week_of <> public.audit_week(week_of);                    -- 0
--   select has_table_privilege('authenticated', 'public.workstream_audits', 'insert');                            -- false
--   select count(*) from pg_trigger where tgname = 'workstream_audit_week_is_closed';                              -- 1
--   select confdeltype from pg_constraint where conname = 'workstream_audits_workstream_id_fkey';                  -- r
--   select count(*) from cron.job where jobname = 'monday-audit-reminder';                                         -- 1
select public.record_migration('0405_a_weeks_audit_is_a_record');
