-- ── 0383 — THE ALERTS TELL THE TRUTH ──────────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. Release 1, "the alerts tell the truth", as the owner approved it on 2026-10-11.
--
-- ── 1 · A FINISHED TASK'S ALERTS CLEAR THEMSELVES, AND ONE TASK SHOWS ONE LINE ────────────────────────────────────────
-- FOUND. A task's alerts never heard what happened to the task.
--   · task_assigned is raised critical by every screen that hands someone a task (app/crew/page.tsx: an event's prep
--     list, a note's follow-ups and its Flag; components/Goals.tsx: a goal's moves), and only a tap on that alert ever
--     closed it. Mark the task done anywhere else — My Tasks, the task sheet, the prep list — delete it, or give it to
--     someone else, and the line stayed open, critical, in the inbox of a person with nothing left to do. A critical
--     never expires (0258), so it stayed for good: 0333 counted three task_assigned lines among the eight criticals it
--     left open on production.
--   · task_due ("⏰ Task past due", task_due_alerts: 0104, restated by 0174) the same: done elsewhere, its line stayed
--     open — and so did it when the date was pushed out, which is what its own words ask for ("Knock it out or push
--     the date").
--   · The inbox reads the newest thirty open alerts (lib/useMyAlerts; 0333's feed window), so every stale line is one
--     real line pushed out of sight.
--   · A late task given to someone showed two lines and counted twice on the bell: its task_assigned and its task_due
--     share a subject but not a kind, and an open alert folds only a raise of its own kind (0372:78-86).
--
-- WHAT. The task tells its alerts — task_alerts_follow_the_task(), after an update of done, assignee or due_at on
-- event_tasks and after a delete. It closes lines the way a mechanism does (ack_at now, ack_by left null: 0258's "the
-- system did it"), never in a person's name, and writes no row, so nothing rings:
--   · done, or deleted: every open task_assigned and task_due line about it, whoever it is addressed to — the team's
--     "Flagged:" line too (a note's Flag on a task nobody has yet). A finished task has nothing left to ask of anyone.
--   · given to someone else, or to nobody: the lines addressed to the person who had it. The new person's
--     task_assigned still comes from the screen that assigned it; nobody is sent anything they were not sent before.
--   · its date moved later, to a time not yet come, or taken off: its open task_due line. The task is not past due
--     any more, and 0104 has already re-armed the sweep, which raises a new line if the new date passes as well. A date
--     moved later that is still in the past leaves the line open — the task is still late — and the sweep's raise for
--     the new date folds into that line (0372) instead of ringing again.
--   · reopened: nothing reopens by itself; 0104 re-arms the sweep, which raises task_due again if the task is late.
-- And task_due_alerts (0174's, otherwise word for word) closes a task's open task_assigned line for the same person as
-- it raises that task's past-due line: one task, one line. Who is sent what is unchanged — the past-due line goes to
-- the assignee, as before.
--
-- existing rows: task_due_alerts — its words, its people and its schedule are unchanged; what changed is which open
-- lines may stand beside its own, and those are closed below by the same rules, by the mechanism (0333's lesson: a fix
-- to how rows are written leaves the rows already written as they were) — a task done or gone; a line addressed to
-- someone who no longer has the task; a past-due line on a task that is not past due; an assigned line beside an open
-- past-due line for the same person and task. Nothing is deleted and nothing rings (an UPDATE does not fan out). It is
-- not run here: its next run, within ten minutes, raises what is due, as it would have.
--
-- ── 2 · "GOT IT" ON A TEAM ALERT IS A CLAIM EVERYONE SEES ─────────────────────────────────────────────────────────────
-- FOUND. "Got it" on a team alert (a broadcast: no target_user_id) is one person's alert_reads row (0157). It takes the
-- line out of that person's inbox and nobody else's, and the escalation counts it as "somebody has it" (0373, 0380):
-- ten minutes on, a critical one person tapped is not sent to the owners again. Nobody else could see who that was —
-- alert_reads is readable by its own person only (0157, "own reads") — so the line stayed in every other inbox, counted
-- on every other bell, while the owners' phones stayed quiet on the strength of a tap none of them could see. And the
-- read is anyone's to write: its policy asks that it be the writer's own, not that the alert be one they can see, so a
-- signed-in customer's read of a team critical, by its id, kept the owners from being paged as well as a crew member's.
-- WHAT. The first Got it on a team alert is a claim, held on the alert itself (claimed_by, claimed_at), where everyone
-- who can see the alert sees it:
--   · alert_claim_on_read(), after a read is written: the first read of an open team alert by someone who can see it —
--     0157's staff read (its role list word for word, as 0372 keeps it) or 0084's brew read, in the alert's own business
--     (0134) — claims it; a later read is that person's own, as before. However the read is written — Got it, Clear
--     all, the quiet-hours digest's Mark all read, a phone still on yesterday's app — it claims the same way, so the
--     app and the database cannot disagree about what counts.
--   · after a read is taken back (Undo): if it was the claimant's, the claim passes to the earliest read still standing
--     by someone who can see the alert, or to nobody.
--   · alert_claimants(alert ids): the claimant's first name, for the team alerts the caller can see. It is the
--     database's answer because a server may not read another person's profile (0003); nothing about anyone's reads is
--     shown — alert_reads stays its own person's.
--   · the inbox (lib/useMyAlerts, app/crew/page.tsx) lists a team alert someone else has after everything still open
--     (a non-critical one in quiet hours waits in the digest with the rest), saying "<first name> has it", and does not
--     count it: not on the bell, not in the critical count, not on the service strip. The person who claimed it no
--     longer sees it, as before.
--   · escalate_unacked_criticals counts the claim, not any read: a claimed critical is not sent again, and a read by
--     someone who cannot see the alert claims nothing and stops nothing.
--   · a new alert is nobody's: a claim written with the alert is dropped (alerts_claim_starts_empty), so "<name> has
--     it" is only ever said of someone who said Got it.
--   · a personal alert is untouched: Got it on one acknowledges the row (ack_at, ack_by), as before, and is no claim.
-- An open team alert somebody already tapped Got it on is claimed by the earliest read by someone who can see it —
-- what the escalation already counted, made visible. Nothing rings: a claim is an UPDATE of claimed_by, and only an
-- update of escalated_at goes to the push function (0373).
--
-- ── 3 · A MUTE AND QUIET HOURS HOLD THE PUSH; A CRITICAL STILL RINGS — the push function's, no database change ────────
-- FOUND. Settings › Notifications promises that a muted category stops pinging you and that during quiet hours
-- non-critical alerts are held "instead of pinging you" (components/NotifPrefs). Only the inbox kept the promise: the
-- push function never read notif_prefs (0177), so a muted category, or an important at 3 AM inside someone's quiet
-- hours, rang their phone like any other.
-- WHAT. supabase/functions/push asks each person an alert would reach (policy.ts whoRings): a category they muted, or
-- their quiet hours on their market's clock (profiles.market → markets.timezone), hold a non-critical alert's push to
-- them; a critical always rings; a team alert is asked person by person. The row, its inbox line, Teams and the email
-- are unchanged. Its changelog line is written here, so the app says so when this ships — after the function does.
--
-- ORDER. Deploy the push function (supabase/functions/push, both files) before this, as 0373 and 0374 asked. Its
-- escalation check reads the claim once the column exists and alert_reads until then, so it is right on either side of
-- the paste; the function from before, left running after the paste, still counts any read — a critical whose only
-- read is by someone who cannot see it would be marked escalated here and skipped there, once, for good. And the
-- changelog below says pushes keep mutes and quiet hours, which is true from the deploy.
--
-- Idempotent: a second run finds no line to close and no read to claim, and writes each changelog line once.
-- changelog: below.

-- ── 1 · the task tells its alerts ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.task_alerts_follow_the_task() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Deleted: every open line about it. (The subject is the task's own id — unique, so no other task's line, in no
  -- other business, can match.)
  if tg_op = 'DELETE' then
    update public.alerts set ack_at = now()
     where subject_id = old.id and kind in ('task_assigned', 'task_due') and ack_at is null;
    return old;
  end if;

  -- Done: every open line about it, whoever it is addressed to.
  if new.done and not old.done then
    update public.alerts set ack_at = now()
     where subject_id = new.id and kind in ('task_assigned', 'task_due') and ack_at is null;
    return new;
  end if;

  -- Given to someone else, or to nobody: the lines addressed to the person who had it.
  if old.assignee is not null and new.assignee is distinct from old.assignee then
    update public.alerts set ack_at = now()
     where subject_id = new.id and kind in ('task_assigned', 'task_due') and target_user_id = old.assignee
       and ack_at is null;
  end if;

  -- Its date moved later, to a time not yet come, or taken off: not past due any more.
  if old.due_at is not null and (new.due_at is null or (new.due_at > old.due_at and new.due_at > now())) then
    update public.alerts set ack_at = now()
     where subject_id = new.id and kind = 'task_due' and ack_at is null;
  end if;
  return new;
end $$;
revoke execute on function public.task_alerts_follow_the_task() from public, anon, authenticated;

comment on function public.task_alerts_follow_the_task() is
  'AFTER UPDATE OF done, assignee, due_at OR DELETE on event_tasks (0383): a task closes its own open task_assigned and task_due alerts (ack_at now, ack_by null — the mechanism, 0258) when it is done or deleted (all of them), when it is given to someone else or to nobody (the previous person''s), and its task_due line when its date moves later to a time not yet come or is taken off. Writes no row, so nothing rings.';

drop trigger if exists event_tasks_alerts_follow on public.event_tasks;
create trigger event_tasks_alerts_follow
  after update of done, assignee, due_at or delete on public.event_tasks
  for each row execute function public.task_alerts_follow_the_task();

-- ── 1 · one task, one line: the past-due line takes the assigned line's place ─────────────────────────────────────────
create or replace function public.task_due_alerts() returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- ONE TASK, ONE LINE (0383): the task about to be raised past due closes its open task_assigned line for the same
  -- person — the mechanism's close (ack_by null), so the past-due line below is the one line that task shows.
  update public.alerts a set ack_at = now()
    from public.event_tasks t
   where a.kind = 'task_assigned' and a.subject_id = t.id and a.target_user_id = t.assignee and a.ack_at is null
     and t.done = false and t.kind = 'task' and t.assignee is not null and t.due_at is not null
     and now() >= t.due_at and not t.due_alerted;

  insert into public.alerts (severity, category, kind, subject_id, title, body, link, target_user_id, tenant_id)
  select case when t.critical then 'critical' else 'important' end, 'prep', 'task_due', t.id,
         '⏰ Task past due — ' || t.label,
         'This task is past its due date' || coalesce(' · ' || e.title, ' · ' || s.name, ' · goal: ' || g.title, '') || '. Knock it out or push the date.',
         '/crew', t.assignee, coalesce(e.tenant_id, g.tenant_id, '00000000-0000-0000-0000-000000000001')
    from public.event_tasks t
    left join public.events e on e.id = t.event_id
    left join public.stops  s on s.id = t.stop_id
    left join public.goals  g on g.id = t.goal_id
   where t.done = false and t.kind = 'task' and t.assignee is not null and t.due_at is not null
     and now() >= t.due_at and not t.due_alerted;

  update public.event_tasks set due_alerted = true
   where done = false and kind = 'task' and assignee is not null and due_at is not null
     and now() >= due_at and not due_alerted;
end; $$;
-- As 0381 left it: the cron's (pg_cron runs as the owner) and the server's, nobody's through the API.
revoke execute on function public.task_due_alerts() from public, anon, authenticated;
grant execute on function public.task_due_alerts() to service_role;

-- ── 1 · the lines already open ────────────────────────────────────────────────────────────────────────────────────────
-- A task done or gone, a line addressed to someone who no longer has it, a past-due line on a task that is not past due.
with stale as (
  select a.id
    from public.alerts a
    left join public.event_tasks t on t.id = a.subject_id
   where a.kind in ('task_assigned', 'task_due')
     and a.ack_at is null
     and a.subject_id is not null
     and (t.id is null
          or t.done
          or (a.target_user_id is not null and t.assignee is distinct from a.target_user_id)
          or (a.kind = 'task_due' and (t.due_at is null or t.due_at > now())))
)
update public.alerts a set ack_at = now() from stale where a.id = stale.id;

-- One task, one line: an assigned line beside an open past-due line for the same person and task.
update public.alerts a set ack_at = now()
 where a.kind = 'task_assigned' and a.ack_at is null and a.target_user_id is not null
   and exists (select 1 from public.alerts d
                where d.kind = 'task_due' and d.ack_at is null
                  and d.subject_id = a.subject_id and d.target_user_id = a.target_user_id);

-- ── 2 · the claim, on the alert ───────────────────────────────────────────────────────────────────────────────────────
alter table public.alerts add column if not exists claimed_by uuid references auth.users(id) on delete set null;
alter table public.alerts add column if not exists claimed_at timestamptz;
comment on column public.alerts.claimed_by is
  'A team alert''s claim (0383): the first person who tapped Got it on it and can see it — written only by alert_claim_on_read from alert_reads, shown to the team as "<first name> has it" (alert_claimants), and counted by escalate_unacked_criticals as somebody having it. Null on a personal alert, and on a team alert nobody has.';
comment on column public.alerts.claimed_at is 'When the claim was made: the claimant''s Got it (alert_reads.read_at), 0383.';

-- Who sees a team alert: 0157's "alerts staff read" for a broadcast (its role list word for word, as 0372 keeps it) or
-- 0084's "alerts brew staff read" (is_staff: not a member, or a legacy admin), in the alert's own business (0134's
-- tenant isolation, the person's tenant or the founding one). Never a device test (0374: always someone's own).
-- Asked about a person the caller names, so nobody calls it through the API — only the definer functions below.
create or replace function public.team_alert_seen_by(p_alert uuid, p_user uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (
    select 1
      from public.alerts a
      join public.profiles p on p.id = p_user
     where a.id = p_alert
       and a.target_user_id is null
       and a.kind is distinct from 'device_test'
       and a.tenant_id = coalesce(p.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid)
       and (p.role in ('server', 'contractor', 'operator', 'event_manager', 'admin', 'owner')
            or (a.category = 'brew' and (p.role is distinct from 'member' or coalesce(p.is_admin, false))))
  )
$$;
revoke execute on function public.team_alert_seen_by(uuid, uuid) from public, anon, authenticated;

-- The first Got it claims; taking it back passes the claim to the earliest Got it still standing, or to nobody.
create or replace function public.alert_claim_on_read() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
  v_at   timestamptz;
begin
  if tg_op = 'INSERT' then
    update public.alerts a
       set claimed_by = new.user_id, claimed_at = new.read_at
     where a.id = new.alert_id
       and a.claimed_by is null
       and a.ack_at is null
       and public.team_alert_seen_by(a.id, new.user_id);
    return new;
  end if;

  if exists (select 1 from public.alerts a where a.id = old.alert_id and a.claimed_by = old.user_id) then
    select r.user_id, r.read_at into v_next, v_at
      from public.alert_reads r
     where r.alert_id = old.alert_id and r.user_id <> old.user_id
       and public.team_alert_seen_by(r.alert_id, r.user_id)
     order by r.read_at, r.user_id
     limit 1;
    update public.alerts a set claimed_by = v_next, claimed_at = v_at
     where a.id = old.alert_id and a.claimed_by = old.user_id;
  end if;
  return old;
end $$;
revoke execute on function public.alert_claim_on_read() from public, anon, authenticated;

comment on function public.alert_claim_on_read() is
  'AFTER INSERT OR DELETE on alert_reads (0383): the first read of an open team alert by someone who can see it (team_alert_seen_by) claims it (alerts.claimed_by, claimed_at); the claimant''s read taken back passes the claim to the earliest read still standing by someone who can see it, or clears it.';

drop trigger if exists alert_reads_claim on public.alert_reads;
create trigger alert_reads_claim after insert or delete on public.alert_reads
  for each row execute function public.alert_claim_on_read();

-- A new alert is nobody's: the claim is made by a Got it, never written with the alert.
create or replace function public.alert_claim_starts_empty() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.claimed_by := null;
  new.claimed_at := null;
  return new;
end $$;
revoke execute on function public.alert_claim_starts_empty() from public, anon, authenticated;

drop trigger if exists alerts_claim_starts_empty on public.alerts;
create trigger alerts_claim_starts_empty before insert on public.alerts
  for each row execute function public.alert_claim_starts_empty();

-- The claimant's first name, for the team alerts the caller can see. Their reads, and anyone else's, stay their own.
create or replace function public.alert_claimants(p_alerts uuid[])
returns table (alert_id uuid, first_name text)
  language sql stable security definer set search_path = public as $$
  select a.id, nullif((regexp_split_to_array(btrim(coalesce(p.display_name, '')), '\s+'))[1], '')
    from public.alerts a
    join public.profiles p on p.id = a.claimed_by
   where a.id = any (p_alerts)
     and public.team_alert_seen_by(a.id, auth.uid())
$$;
revoke execute on function public.alert_claimants(uuid[]) from public, anon;
grant execute on function public.alert_claimants(uuid[]) to authenticated, service_role;

comment on function public.alert_claimants(uuid[]) is
  'The inbox''s "<first name> has it" (0383): for each of the given team alerts the caller can see (team_alert_seen_by) that somebody has claimed, the claimant''s first name. Nothing else about anyone; alert_reads stays its own person''s.';

-- The escalation counts the claim (0373's, otherwise word for word).
create or replace function public.escalate_unacked_criticals() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- A cron job's, across every business: each escalation names its own tenant, and the push function sends it only
  -- to that tenant's people. Somebody has it (0383): the claim, which the team sees — not any read, which anyone
  -- signed in could write.
  with due as (
    select a.id
      from public.alerts a
     where a.severity = 'critical'
       and a.ack_at is null
       and a.escalated_at is null
       and a.kind is distinct from 'device_test'
       and (a.target_user_id is null or a.escalate_after_min is not null)
       and a.created_at <= now() - interval '10 minutes'
       and a.created_at >  now() - interval '12 hours'
       and a.claimed_by is null
     order by a.created_at
     limit 50
     for update skip locked
  )
  update public.alerts a set escalated_at = now() from due where a.id = due.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.escalate_unacked_criticals() from public, anon, authenticated;

comment on function public.escalate_unacked_criticals() is
  'Every minute (pg_cron escalate-criticals, 0373): marks escalated_at on a critical nobody has acknowledged ten minutes after it was raised (ack_at null and, since 0383, nobody has claimed it — alerts.claimed_by) — every broadcast, and a targeted one that carries escalate_after_min; never a device_test; within twelve hours of being raised. alerts_push_escalation hands the mark to the push function, which sends it once more to its people and every admin and owner of its tenant. Inserts nothing.';

-- The team alerts somebody already tapped Got it on: claimed by the earliest read by someone who can see them.
update public.alerts a
   set claimed_by = c.user_id, claimed_at = c.read_at
  from (select distinct on (r.alert_id) r.alert_id, r.user_id, r.read_at
          from public.alert_reads r
          join public.alerts x on x.id = r.alert_id
         where x.target_user_id is null and x.ack_at is null and x.claimed_by is null
           and public.team_alert_seen_by(r.alert_id, r.user_id)
         order by r.alert_id, r.read_at, r.user_id) c
 where a.id = c.alert_id and a.claimed_by is null;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A finished task''s alerts clear themselves','fix','Alerts',
   'When a task is marked done — anywhere, not only from its alert — or deleted, its "assigned to you" and "past due" alerts clear on their own, and when it is given to someone else, the alerts of the person who had it clear. Pushing a late task''s date into the future clears its past-due alert. A late task shows one line in the inbox instead of two. Nothing new rings.',
   '2026-10-12', false),
  ('"Got it" on a team alert shows who has it','fix','Alerts',
   'Tapping Got it on an alert for the whole team picks it up for you, and everyone else sees "<your first name> has it" on it: it stays in their inbox, below what still needs someone, and no longer counts on their bell. Undo it and it is the next person''s who tapped it, or nobody''s. The owners are sent a critical again only when nobody has it — before, one person''s tap stopped that without anyone else seeing who. Alerts for you alone work as before.',
   '2026-10-12', true),
  ('Muted categories and quiet hours stop the ping too','fix','Alerts',
   'A category you mute in Settings › Notifications no longer buzzes your phone, and during your quiet hours other alerts wait in your inbox instead of pinging you — as Settings always said. Before, only the inbox listened; the phone rang anyway. Quiet hours run on your city''s clock and cross midnight (10pm–7am works). Critical alerts always come through, and an alert for the whole team is checked person by person, so your quiet hours never silence a teammate''s phone.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname from pg_trigger where tgrelid = 'public.event_tasks'::regclass and tgname = 'event_tasks_alerts_follow';   -- one row
--   select count(*) from public.alerts a join public.event_tasks t on t.id = a.subject_id
--    where a.kind in ('task_assigned', 'task_due') and a.ack_at is null and t.done;                                         -- 0
--   select count(*) from public.alerts a
--    where a.kind in ('task_assigned', 'task_due') and a.ack_at is null and a.subject_id is not null
--      and not exists (select 1 from public.event_tasks t where t.id = a.subject_id);                                        -- 0
--   select has_function_privilege('authenticated', 'public.task_alerts_follow_the_task()', 'execute');                     -- f
--   select has_function_privilege('anon', 'public.task_due_alerts()', 'execute');                                          -- f
--   select tgname from pg_trigger where tgrelid = 'public.alert_reads'::regclass and tgname = 'alert_reads_claim';          -- one row
--   select has_function_privilege('authenticated', 'public.alert_claimants(uuid[])', 'execute'),
--          has_function_privilege('anon', 'public.alert_claimants(uuid[])', 'execute'),
--          has_function_privilege('authenticated', 'public.team_alert_seen_by(uuid,uuid)', 'execute');                     -- t, f, f
--   select count(*) from public.alerts a
--    where a.target_user_id is null and a.ack_at is null and a.claimed_by is null
--      and exists (select 1 from public.alert_reads r where r.alert_id = a.id and public.team_alert_seen_by(a.id, r.user_id));   -- 0
select public.record_migration('0383_the_alerts_tell_the_truth');
