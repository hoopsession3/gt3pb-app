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
-- pending-from: 0385
-- generated-at: 2026-10-12
-- pending-count: 4
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- held: 0376_nobody_on_the_pass_during_service_is_an_alert.sql — NOT in this file; applied by hand once the condition in its header is met
-- ============================================================
-- 0382_merch_recipes_and_lessons_are_written_by_owners_and_admins.sql
-- ============================================================
-- ── 0382 — MERCH, RECIPES AND LESSONS ARE WRITTEN BY OWNERS AND ADMINS ────────────────────────────────────────────
-- 2026-10-12. Found by the Today, Command, Audit & Catalog audit, and confirmed in production's security snapshot
-- (supabase/schema.security.json, pulled at ledger 0380; the owner approved building this on 2026-10-12).
--
-- WHY. When the Catalog became a section of its own (0352), its header said the panels in it "write what they wrote
-- before, under the policies they had (0351: owner or admin)". Three of them never had such a policy. Every one of
-- these lets ANY staff role write, through the API, with the app's public key and their own sign-in:
--   · shop_products       "shop products staff write"   (0271:110-112)  — merch: titles, prices, costs, what is published
--   · product_components  "pc staff write"              (0062:59-61)   — a drink's recipe, which costs every serving
--   · primal_lessons      "primal lessons write"        (0272:167-169)  — the lessons members pay to take
-- So a server or an event manager could reprice a shirt, change what a serving of RISE costs or rewrite a lesson,
-- without opening a screen that offers it. The screens that do (components/MerchManager, MenuManager's recipe rows,
-- LessonsManager) are in the Catalog, which only owners and admins open (components/OperatorNav ROLE_SECTIONS).
--
-- WHAT. Each of the three write policies is replaced by one that admits owners and admins only (public.is_admin():
-- role owner or admin, or the is_admin flag — the same test 0351 uses for products). Untouched:
--   · every read policy (the shop's public read, the crew's recipe read, members' lessons);
--   · the "tenant isolation" restrictive policy on each table, which still applies on top;
--   · the server's own writes (app/api/apliiq/*), which use the service role and are not subject to these policies;
--   · the 86. It is products.sold_out, written under 0351's rule (any crew role may change sold-out and nothing else),
--     on a table this migration does not touch.
-- A second run changes nothing.
-- changelog: none — nobody's screen changes; a door the screens never offered is closed.

drop policy if exists "shop products staff write" on public.shop_products;
drop policy if exists "shop products admin write" on public.shop_products;
create policy "shop products admin write" on public.shop_products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "pc staff write" on public.product_components;
drop policy if exists "pc admin write" on public.product_components;
create policy "pc admin write" on public.product_components for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "primal lessons write" on public.primal_lessons;
drop policy if exists "primal lessons admin write" on public.primal_lessons;
create policy "primal lessons admin write" on public.primal_lessons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- verify (names and booleans only):
--   select policyname from pg_policies where tablename in ('shop_products','product_components','primal_lessons')
--    order by tablename, policyname;   -- the three "… admin write" names; no "staff write", no "primal lessons write"
--   select count(*) from pg_policies where tablename in ('shop_products','product_components','primal_lessons')
--      and qual like '%is_staff%' and cmd = 'ALL';                                              -- 0
select public.record_migration('0382_merch_recipes_and_lessons_are_written_by_owners_and_admins');

-- ============================================================
-- 0383_the_alerts_tell_the_truth.sql
-- ============================================================
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

-- ============================================================
-- 0384_the_money_numbers_are_honest.sql
-- ============================================================
-- ── 0384 — THE MONEY NUMBERS ARE HONEST ─────────────────────────────────────────────────────────────────────────────
-- 2026-10-12. Release 1 of the money audit, approved by the owner on 2026-10-11. Five findings in what Money reads, all
-- from the code. Paste into Supabase → SQL Editor → Run. Idempotent: a second run changes nothing.
--
-- 1. A SHOP PAYMENT WAS A WALK-UP. report_sales counts a Square payment as a walk-up when it matches no app order's
--    payment id (0216, 0220). The match looked in orders, drop_orders, delivery_orders and business_orders and never in
--    shop_orders, and the webhook mirrors every completed Square payment into event_sales against whatever event is live
--    (app/api/square/webhook/route.ts, the payment.* branch). So every merch or program purchase counted as a walk-up,
--    and one paid while an event was live joined that event's takings: Sales' "Revenue by event" and the per-event P&L.
--    Now the shop is its own channel ('shop': each order's total less what was refunded, canceled orders out, as
--    v_shop_queue counts them), the walk-up match looks in shop_orders too, and a shop payment joins no event.
--    A SUBSCRIPTION'S PAYMENT STAYS A WALK-UP, because nothing stored can tell it from one. Square bills a subscription
--    through an invoice whose payment arrives through the same payment.* event as a sale at the window, and:
--      · event_sales keeps the payment id, the amount and the live event — not the payment's Square order id or customer;
--      · subscriptions keeps the Square subscription and card — no invoice, order or payment id;
--      · the webhook's invoice.payment_made branch writes the subscription's status and nothing about the payment;
--      · webhook_events holds the raw payloads for 30 days only (purge_webhook_events), so it cannot be the record.
--    Filing them needs the webhook to keep payment.order_id on event_sales and each paid invoice's order_id against its
--    subscription. Subscriptions are off until the owner switches them on (live_status.subscriptions_enabled, 0150).
--    And every channel now says how many orders it holds ('orders_by_channel'), so an average is a channel's revenue over
--    that channel's orders. Sales divided ALL revenue by CUP orders alone (components/Reports.tsx, order_count).
--
-- 2. AN ESTIMATE DID NOT SAY SO. cogs_pct is the menu's blended cost of goods (catalog_cogs_pct, 0216), and 30% when no
--    product has a recipe. report_sales now says what it rests on ('cogs_basis': the priced menu products, how many have
--    every ingredient costed — the COGS calculator's own test, lib/cogs drinkCogs — and whether the 30% was assumed), and
--    report_events marks the events with no saved costs ('costs_saved' false), whose net is the blend and nothing else.
--
-- 3. ANY CREW MEMBER COULD READ THE BOOKS. report_sales, report_events, report_snapshot, report_spend and
--    report_product_mix checked is_staff(), so every server, contractor, operator and event manager could call them for
--    revenue, margins, MRR, spend and budgets; and anon could call them through PUBLIC's grant, to be told 'unauthorized'.
--    The console gives Money to owners and admins (app/crew/page.tsx: sec === "money" && isAdmin); the database now
--    agrees: each checks is_admin() (role admin or owner, 0035), and EXECUTE is taken from PUBLIC and anon. Untouched,
--    because they were already right: product_economics and event_economics are admin-only (0028), and
--    product_economics_live reads them as the caller (0256). No server route calls a report (app/api has no
--    supabaseAdmin.rpc of one; the daily digest sums the tables itself). service_role keeps EXECUTE, as Supabase's
--    default privileges give it, and like any caller without an admin's session is answered 'unauthorized'.
--
-- 4. THE SNAPSHOT COUNTED EVERY BUSINESS. report_snapshot (0048) predates tenants and filtered by none: inventory value,
--    subscribers, MRR, members and repeat buyers summed every tenant's rows. It reads the caller's tenant now
--    (effective_tenant()), as report_sales, report_events and report_spend have since 0216.
--
-- 5. A BUDGET SAVED IN THE EVENING STARTED NEXT MONTH. Spend & budget dated a budget with the UTC date of the first of
--    the month at the moment it was saved (components/SpendBudget.tsx: new Date(), setDate(1), toISOString()), so one
--    saved after 8 pm Eastern (7 pm in winter) was dated the 2nd — and report_spend, which takes the latest budget dated
--    on or before the 1st, applied it from the month after. report_spend's month defaulted to current_date, UTC's, so from
--    8 pm on the last day of a month the panel read the next month. The panel now cuts the month in Eastern time
--    (lib/spend businessMonthStart) and asks for it by name; report_spend's default is business_day() (0348); and the
--    budgets the bug dated the 2nd move to the 1st of their month — unless one is already dated the 1st for the same
--    category and city, which then stays the one in force, as it is today.
--
-- Each function is its latest definition (report_sales 0358, report_events 0220, report_snapshot 0048, report_spend 0292,
-- report_product_mix 0231) with only the lines above changed. Same signatures, same return types; the payloads gain keys
-- and lose none. The app half ships in the same change: lib/reports, lib/home, lib/spend, lib/economics, components/
-- Reports, SnapshotReport, EventPnlReport, SpendBudget, HomeNumbers and the console's live event card. Paste this before
-- the deploy that reads it; pasted after, nothing breaks — the screens read the new keys when they are there.
-- scripts/db.money.test.mjs runs this file against every migration before it and shows each finding first.
-- changelog: below.

-- ── 1 · report_sales: the shop is a channel, every channel counts its orders, the margin says what it knows ───────
-- 0358's function but the shop channel, the shop clause in both walk-up matches and in by_event, orders_by_channel,
-- cogs_basis and is_admin().
create or replace function public.report_sales(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (current_date - (greatest(p_days, 1) - 1))::timestamptz;
  tid uuid := public.effective_tenant();
  sq bigint; cup bigint; packs bigint; deliv bigint; office bigint; shop bigint;
  sq_n bigint;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  select coalesce(sum(es.amount_cents), 0), count(*) into sq, sq_n from event_sales es
              where es.created_at >= since and es.tenant_id = tid
                and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
                and not exists (select 1 from drop_orders d where d.payment_id = es.square_payment_id)
                and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
                and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
                and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id);
  cup    := coalesce((select sum(total_cents) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid), 0);
  packs  := coalesce((select sum(total_cents) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  deliv  := coalesce((select sum(total_cents) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid), 0);
  office := coalesce((select sum(total_cents) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid), 0);
  shop   := coalesce((select sum(total_cents - coalesce(refund_amount_cents, 0)) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid), 0);
  return jsonb_build_object(
    'days', p_days,
    'revenue_basis', 'reconciled',
    'revenue_cents', sq + cup + packs + deliv + office + shop,
    'by_channel', jsonb_build_object('square_walkup', sq, 'cup', cup, 'packs', packs, 'delivery', deliv, 'office', office, 'shop', shop),
    -- Each channel's orders under the same rule as its money, so an average never divides one channel by another's count.
    'orders_by_channel', jsonb_build_object(
      'square_walkup', sq_n,
      'cup',      (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
      'packs',    (select count(*) from drop_orders where paid and canceled_at is null and created_at >= since and tenant_id = tid),
      'delivery', (select count(*) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at >= since and tenant_id = tid),
      'office',   (select count(*) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date between since::date and current_date and tenant_id = tid),
      'shop',     (select count(*) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at >= since and tenant_id = tid)),
    'order_count', (select count(*) from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid),
    'cogs_pct', public.catalog_cogs_pct(),
    -- What cogs_pct rests on. 'costed' is the COGS calculator's test (every ingredient has a unit cost and a quantity);
    -- 'assumed' is catalog_cogs_pct's own fallback, 30%, taken when no priced product has a recipe at all.
    'cogs_basis', (select jsonb_build_object(
        'products', count(*),
        'costed',   count(*) filter (where m.costed),
        'assumed',  not exists (select 1 from products p
                                  join product_components pc on pc.product_id = p.id
                                  join inventory_items ii on ii.id = pc.inventory_item_id
                                 where p.price_cents > 0 and p.tenant_id = tid and ii.tenant_id = tid))
      from (select p.id,
                   exists (select 1 from product_components pc where pc.product_id = p.id)
                   and not exists (select 1 from product_components pc
                                     left join inventory_items ii on ii.id = pc.inventory_item_id
                                    where pc.product_id = p.id and (ii.unit_cost is null or pc.qty_per_serving is null)) as costed
              from products p where p.active and p.price_cents > 0 and p.tenant_id = tid) m),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('key', item, 'n', n, 'cents', cents) order by n desc) from (
        select unnest(items) item, count(*) n,
               sum(total_cents / greatest(coalesce(array_length(items, 1), 1), 1)) cents
        from orders where paid and status <> 'void' and created_at >= since and tenant_id = tid group by 1
      ) p), '[]'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', coalesce(e.title, '(unlinked)'), 'cents', s.cents, 'orders', s.n) order by s.cents desc) from (
        select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where created_at >= since and tenant_id = tid
          and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id) group by 1
      ) s left join events e on e.id = s.event_id), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d, 'MM-DD'), 'cents', coalesce(c, 0)) order by d) from (
        select g::date d,
          (select coalesce(sum(es.amount_cents), 0) from event_sales es where es.created_at::date = g::date and es.tenant_id = tid
             and not exists (select 1 from orders o where o.payment_id = es.square_payment_id)
             and not exists (select 1 from drop_orders dd2 where dd2.payment_id = es.square_payment_id)
             and not exists (select 1 from delivery_orders dv where dv.payment_id = es.square_payment_id)
             and not exists (select 1 from business_orders b where b.payment_id = es.square_payment_id)
             and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id))
          + (select coalesce(sum(total_cents), 0) from orders o where o.paid and o.status <> 'void' and o.created_at::date = g::date and o.tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from drop_orders where paid and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from delivery_orders where payment_status = 'paid' and canceled_at is null and created_at::date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents), 0) from business_orders where payment_status = 'paid' and canceled_at is null and delivery_date = g::date and tenant_id = tid)
          + (select coalesce(sum(total_cents - coalesce(refund_amount_cents, 0)), 0) from shop_orders where status <> 'canceled' and total_cents > 0 and created_at::date = g::date and tenant_id = tid) c
        from generate_series(since::date, current_date, interval '1 day') g
      ) dd), '[]'::jsonb)
  );
end; $$;

-- ── 2 · report_events: a shop payment joins no event, and an event says whether its costs were saved ────────────
-- 0220's function but the shop clause, 'costs_saved' and is_admin().
create or replace function public.report_events()
returns jsonb language plpgsql security definer set search_path = public as $$
declare blended numeric := public.catalog_cogs_pct(); tid uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  return coalesce((select jsonb_agg(payload order by cents desc, sort_key) from (
    select jsonb_build_object(
        'id', e.id, 'kind', 'event',
        'event', e.title,
        'actual_cents', coalesce(s.cents, 0),
        'orders', coalesce(s.n, 0),
        'cogs_pct', coalesce(ec.cogs_pct, blended),
        'fixed_cents', coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0),
        'margin_cents', round(coalesce(s.cents,0) * (1 - coalesce(ec.cogs_pct, blended)))
                        - (coalesce(ec.booth_cents,0) + coalesce(ec.transport_cents,0) + coalesce(ec.permit_cents,0) + coalesce(ec.consumables_cents,0)),
        'costs_saved', (ec.event_id is not null)
      ) as payload, coalesce(s.cents,0) as cents, coalesce(e.sort, 0)::numeric as sort_key
    from events e
    left join (select event_id, sum(amount_cents) cents, sum(item_count) n from event_sales es where tenant_id = tid
                 and not exists (select 1 from shop_orders sh where sh.payment_id = es.square_payment_id)
               group by event_id) s on s.event_id = e.id
    left join event_economics ec on ec.event_id = e.id
    where e.archived_at is null and e.tenant_id = tid
    union all
    select jsonb_build_object(
        'id', st.id, 'kind', 'stop',
        'event', '🚚 ' || st.name,
        'actual_cents', so.cents,
        'orders', so.n,
        'cogs_pct', blended,
        'fixed_cents', 0,
        'margin_cents', round(so.cents * (1 - blended)),
        'costs_saved', false
      ), so.cents, 100000::numeric
    from stops st
    join (select stop_id, sum(total_cents) cents, count(*) n from orders
            where paid and status <> 'void' and stop_id is not null and tenant_id = tid group by stop_id) so on so.stop_id = st.id
    where st.archived_at is null and st.tenant_id = tid
  ) all_rows), '[]'::jsonb);
end; $$;

-- ── 3 · report_snapshot: this business's rows, for its owners and admins ─────────────────────────────────────────
-- 0048's function but tid, a tenant filter on every table it reads, and is_admin(). subscription_plans carries no
-- tenant: it is the price list the active subscriptions are joined to.
create or replace function public.report_snapshot()
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'inventory', jsonb_build_object(
      'item_count', (select count(*) from inventory_items where tenant_id = tid),
      'value_cents', coalesce((select round(sum(coalesce(qty,0) * coalesce(unit_cost,0)) * 100)
                                 from inventory_items where coalesce(status,'On Hand') not in ('Returned','Consumed') and tenant_id = tid), 0),
      'low_stock', (select count(*) from inventory_items where qty is not null and reorder_point is not null and qty <= reorder_point and tenant_id = tid),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('cat', coalesce(category,'Uncategorized'), 'value_cents', round(v * 100)) order by v desc) from (
          select category, sum(coalesce(qty,0) * coalesce(unit_cost,0)) v from inventory_items
          where coalesce(status,'On Hand') not in ('Returned','Consumed') and tenant_id = tid group by category having sum(coalesce(qty,0) * coalesce(unit_cost,0)) > 0
        ) c), '[]'::jsonb)
    ),
    'subs', jsonb_build_object(
      'active',   (select count(*) from subscriptions where status = 'active' and tenant_id = tid),
      'past_due', (select count(*) from subscriptions where status = 'past_due' and tenant_id = tid),
      'paused',   (select count(*) from subscriptions where status = 'paused' and tenant_id = tid),
      'total',    (select count(*) from subscriptions where tenant_id = tid),
      'mrr_cents', coalesce((select round(sum(sp.price_cents * 365.0 / nullif(sp.period_days,0) / 12))
                               from subscriptions s join subscription_plans sp on sp.key = s.plan where s.status = 'active' and s.tenant_id = tid), 0),
      'by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'n', n) order by n desc) from (
          select plan, count(*) n from subscriptions where status = 'active' and tenant_id = tid group by plan
        ) p), '[]'::jsonb)
    ),
    'loyalty', jsonb_build_object(
      'members',          (select count(*) from profiles where tenant_id = tid),
      'points_out',       coalesce((select sum(points) from profiles where tenant_id = tid), 0),
      'buyers',           (select count(distinct user_id) from orders where status <> 'void' and user_id is not null and tenant_id = tid),
      'repeat_customers', (select count(*) from (
          select user_id from orders where status <> 'void' and user_id is not null and tenant_id = tid group by user_id having count(*) > 1
        ) r)
    )
  );
end; $$;

-- ── 4 · report_spend: the month is the business's, Eastern ───────────────────────────────────────────────────────
-- 0292's function but the default month (business_day(), not current_date) and is_admin(). A default is evaluated by
-- the caller, so business_day() must stay callable by authenticated — it is: a plain function, PUBLIC's grant untouched.
create or replace function public.report_spend(p_month date default public.business_day(), p_market text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mstart date := date_trunc('month', p_month)::date;
  mend   date := (date_trunc('month', p_month) + interval '1 month')::date;
  tid    uuid := public.effective_tenant();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'unauthorized'); end if;

  return jsonb_build_object(
    'month', to_char(mstart, 'YYYY-MM'),
    'market', p_market,
    'total_spent_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is null
         and tenant_id = tid and (p_market is null or market = p_market)), 0),
    'total_budget_cents', coalesce((
      select sum(b.monthly_limit_cents) from (
        select distinct on (category, market) category, market, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market)
           and effective_from <= mstart
         order by category, market, effective_from desc
      ) b), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.slug,
        'label', c.label,
        'budget_cents', coalesce(b.monthly_limit_cents, 0),
        'spent_cents',  coalesce(s.spent, 0)
      ) order by coalesce(s.spent, 0) desc, c.sort, c.slug)
      from public.spend_categories c
      left join (
        select distinct on (category) category, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market) and effective_from <= mstart
         order by category, effective_from desc
      ) b on b.category = c.slug
      left join (
        select category, sum(amount_cents) spent from expenses
         where spent_on >= mstart and spent_on < mend and voided_at is null
           and tenant_id = tid and (p_market is null or market = p_market)
         group by category
      ) s on s.category = c.slug
      where c.active or coalesce(s.spent, 0) > 0
    ), '[]'::jsonb),
    'voided_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is not null
         and tenant_id = tid and (p_market is null or market = p_market)), 0)
  );
end $$;

-- ── 5 · report_product_mix: owners and admins ────────────────────────────────────────────────────────────────────
-- 0231's function but is_admin(). Nothing in the app calls it today; it is a money report all the same.
create or replace function public.report_product_mix(p_days int default 30)
returns table (slug text, name text, qty bigint, revenue_cents bigint, has_estimates boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'owners and admins only'; end if;
  return query
  select oi.slug, max(coalesce(oi.name, oi.slug)) as name,
         sum(oi.qty)::bigint as qty,
         (sum(coalesce(oi.unit_price_cents, 0)::bigint * oi.qty))::bigint as revenue_cents,
         bool_or(oi.estimated) as has_estimates
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.paid = true
    and oi.tenant_id = public.effective_tenant()
    and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by oi.slug
  order by revenue_cents desc, qty desc;
end $$;

-- ── 6 · who may call them ────────────────────────────────────────────────────────────────────────────────────────
-- Closed to PUBLIC and anon, kept for the signed-in person (the check inside decides) and for the service role.
revoke execute on function public.report_sales(int) from public, anon, authenticated;
revoke execute on function public.report_events() from public, anon, authenticated;
revoke execute on function public.report_snapshot() from public, anon, authenticated;
revoke execute on function public.report_spend(date, text) from public, anon, authenticated;
revoke execute on function public.report_product_mix(int) from public, anon, authenticated;
grant execute on function public.report_sales(int) to authenticated, service_role;
grant execute on function public.report_events() to authenticated, service_role;
grant execute on function public.report_snapshot() to authenticated, service_role;
grant execute on function public.report_spend(date, text) to authenticated, service_role;
grant execute on function public.report_product_mix(int) to authenticated, service_role;

-- ── 7 · the budgets the evening dated the 2nd ────────────────────────────────────────────────────────────────────
-- existing rows: budgets — a row dated after the 1st of its month only ever came from finding 5 (the panel offers no
-- other day; 0292 dated the older rows 2000-01-01), and was meant for the month it was saved in. Moved to that 1st,
-- one per category, city and month (the latest, if somehow two), and only where no budget is already dated that 1st:
-- that one is what the month has been reading, and it stays in force.
update public.budgets b
   set effective_from = date_trunc('month', b.effective_from)::date,
       updated_at     = now()
 where b.id in (
         select distinct on (x.tenant_id, x.market, x.category, date_trunc('month', x.effective_from)) x.id
           from public.budgets x
          where x.effective_from <> date_trunc('month', x.effective_from)::date
          order by x.tenant_id, x.market, x.category, date_trunc('month', x.effective_from), x.effective_from desc, x.updated_at desc)
   and not exists (
         select 1 from public.budgets f
          where f.tenant_id = b.tenant_id and f.market is not distinct from b.market and f.category = b.category
            and f.effective_from = date_trunc('month', b.effective_from)::date);

-- ── what changed ─────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The money numbers say what they are','fix','Money',
   'Shop and program sales are their own line in Sales instead of being counted as walk-ups, and one paid during an event no longer counts toward that event. Each channel''s average order is its own revenue over its own orders — the average used to divide all revenue by cup orders alone. A margin says how much of the menu has a known cost, or that 30% is assumed, and an event''s net says it is an estimate and what it assumed. A panel that could not read its numbers says so, with Try again, instead of showing nothing or $0. Sales, the snapshot, the event P&L and spend are for owners and admins only, and the snapshot counts this business alone. A budget saved in the evening starts this month, not next.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select proname, prosrc like '%public.is_admin()%' from pg_proc where proname in ('report_sales', 'report_events', 'report_snapshot', 'report_spend', 'report_product_mix') order by 1;   -- t ×5
--   select count(*) from pg_proc where proname like 'report\_%' and has_function_privilege('anon', oid, 'execute');      -- 0
--   select count(*) from pg_proc where proname like 'report\_%' and has_function_privilege('service_role', oid, 'execute');   -- 5
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_sales';   -- t
--   select prosrc like '%shop_orders sh where sh.payment_id = es.square_payment_id%' from pg_proc where proname = 'report_events';  -- t
--   select prosrc like '%''orders_by_channel''%' and prosrc like '%''cogs_basis''%' from pg_proc where proname = 'report_sales';     -- t
--   select prosrc like '%''costs_saved''%' from pg_proc where proname = 'report_events';                                       -- t
--   select prosrc like '%and tenant_id = tid%' from pg_proc where proname = 'report_snapshot';                         -- t
--   select pg_get_function_arguments('public.report_spend(date, text)'::regprocedure) like '%business_day()%';           -- t
--   select count(*) from public.budgets where effective_from <> date_trunc('month', effective_from)::date;               -- 0, or the few behind a budget already dated the 1st
select public.record_migration('0384_the_money_numbers_are_honest',
  'report_sales: shop channel (shop_orders total less refunds, canceled out) and shop_orders in both walk-up matches and by_event, orders_by_channel, cogs_basis {products, costed, assumed}; report_events: shop payments join no event, costs_saved; report_snapshot: effective_tenant() on every table; report_spend: default month business_day(); all five report_* gate on is_admin(), EXECUTE revoked from public and anon, granted to authenticated and service_role; budgets dated after the 1st of their month (the UTC cut) moved to the 1st where none is already dated there.');

-- ============================================================
-- 0385_going_live_says_how_many_will_hear.sql
-- ============================================================
-- ── 0385 — GOING LIVE SAYS HOW MANY PEOPLE WILL HEAR ─────────────────────────────────────────────────────────────────
-- 2026-10-12. The Live Ops round; the owner approved the Go live pre-flight on 2026-10-12.
--
-- WHY. Go live on Live Ops opens a sheet of checks now (components/crew/GoLiveSheet, lib/liveOps preflight), and the
-- sheet says what going live does: "Go live and tell 12 people" — the people who asked on Find Us to hear when the truck
-- goes live. Their hand is push_subscriptions.wants_live (0257), and the push function sends each of them one ping when
-- live_status flips to live: its filter is wants_live = true and the business's tenant_id
-- (supabase/functions/push/index.ts, the live_status UPDATE case). The number had nowhere to come from without reading
-- those rows — a device's endpoint and its keys, a guest's among them — and no screen should hold one to count it.
--
-- WHAT. live_ping_count(): how many of the caller's business's devices have asked to hear (wants_live), and nothing
-- else — the push function's own filter, so the number on the button is who the ping goes to. One row is one device
-- (endpoint is unique, 0006), as the function sends one ping a device.
--   · SECURITY DEFINER, search_path pinned: it counts rows the caller cannot read, and says only how many.
--   · For owners and admins: public.is_admin() (0035) — the test admin_set_live asks (0124), so whoever may go live may
--     know how many it tells, and no one else: an event manager, the crew and a member are refused (42501), and anon
--     cannot call it at all.
--   · Its own business: effective_tenant() (0134). A definer is not under 0134's tenant isolation, so the function says
--     the tenant itself.
--   · PUBLIC's execute is revoked (anon and authenticated are members of PUBLIC: 0381's rule), and authenticated's given
--     back; the function refuses inside it anyone not an owner or an admin.
-- Untouched: push_subscriptions and its policies, the push function, who may go live (admin_set_live is unchanged), and
-- what a ping says.
--
-- ORDER. Paste it with the deploy that carries Live Ops' rows, or after it: the app works on either side (before it is
-- pasted the sheet says "Couldn't count who asked on Find Us to hear — they're still told", the call answering
-- PGRST202 — never 0), and its changelog line, below, says what that deploy does.
--
-- existing rows: none written. A second run replaces the function with itself, and writes the changelog line once.
-- changelog: below.

create or replace function public.live_ping_count() returns integer
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select count(*)::integer from public.push_subscriptions s
           where s.wants_live and s.tenant_id = public.effective_tenant());
end $$;
revoke all on function public.live_ping_count() from public, anon, authenticated;
grant execute on function public.live_ping_count() to authenticated;

comment on function public.live_ping_count() is
  'Go live''s checks (0385, components/crew/GoLiveSheet): how many devices of the caller''s business asked on Find Us to hear when the truck goes live (push_subscriptions.wants_live, 0257) — the rows the push function pings on the flip. A number only; owners and admins only (is_admin(), as admin_set_live asks).';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Live Ops reads at a glance','improvement','Ops',
   'Live Ops opens on one row for the Pass and one for the truck, each saying where it stands in words — "Pass clear · 2 phones can ring", "Off the road · next: Wine Express · Sat 11:00am" — with its one action. A line leads the screen only while something is hurting service: tickets past their promise, no phone on the Pass that can ring, or a paid order that didn''t record. Go live first shows whether the stop is due, a phone is on the Pass with its alerts on, and the stop is on the map, and how many people asked to hear — "Go live and tell 12 people". Go live and Go offline show only to owners and admins, who can use them, and an alert opens only where its reader can go.',
   '2026-10-12', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.live_ping_count()', 'execute');            -- f
--   select has_function_privilege('authenticated', 'public.live_ping_count()', 'execute');   -- t
--   select prosecdef, proconfig from pg_proc where proname = 'live_ping_count';              -- t, {search_path=public}
select public.record_migration('0385_going_live_says_how_many_will_hear');
