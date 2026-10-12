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
-- Idempotent: a second run finds no line to close and writes the changelog once.
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

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A finished task''s alerts clear themselves','fix','Alerts',
   'When a task is marked done — anywhere, not only from its alert — or deleted, its "assigned to you" and "past due" alerts clear on their own, and when it is given to someone else, the alerts of the person who had it clear. Pushing a late task''s date into the future clears its past-due alert. A late task shows one line in the inbox instead of two. Nothing new rings.',
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
select public.record_migration('0383_the_alerts_tell_the_truth');
