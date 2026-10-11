-- ── 0373 — A CRITICAL NOBODY PICKS UP RINGS THE OWNERS AGAIN ───────────────────────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts).
--
-- WHY. A critical is the alert that must not go cold: a paid order that did not record, a refund to make, a charge
-- nobody can account for, a brew about to be ruined. The ladder meant to catch one nobody answered never rang:
--   · escalate_unacked_criticals (0162, restated by 0174) waited thirty minutes, then wrote a copy of a broadcast
--     critical to its lane's owner (work_streams.owner_user_id) and marked the original escalated either way. No lane
--     has an owner — 0159 seeds none — so it marked, and sent nothing. No critical has ever escalated.
--   · It counted a broadcast as unanswered while "Got it" on a broadcast is one person's read (alert_reads, 0157)
--     that never sets ack_at: the day a lane had an owner, a refund someone had already marked done would have gone up.
--   · Anyone could run it: it was never revoked from the API roles.
--
-- WHAT. escalate_unacked_criticals, every minute: a critical nobody has acknowledged ten minutes after it was raised
-- is marked escalated — once — and alerts_push_escalation hands that UPDATE to the push function, which sends the
-- alert again to its own people and to every admin and owner of its business ("Still open — …", a notification of
-- its own, so it rings beside the first: supabase/functions/push). Nothing is inserted. It is the same line, marked,
-- so the inbox does not grow, and acknowledging it once clears it.
--   · Acknowledged: ack_at is set (by the person it is for, or a mechanism), or — on a broadcast — anyone has tapped
--     Got it (an alert_reads row): somebody has it. Acknowledging stops it: before ten minutes nothing is sent, and the
--     push function asks again just before it sends.
--   · Which criticals: every broadcast — the team's to pick up — and a person's own critical that carries a window
--     to escalate on (escalate_after_min, 0050's "re-ping window for criticals": the brew ladder's start-now and
--     bottle-now). A task handed to someone and flagged critical is theirs to answer; escalating it would ring the
--     owner who assigned it, ten minutes after they did.
--   · Never a device test (0374): it is one person's own, shown to nobody else.
--   · Not one raised more than twelve hours ago — 0344's rule, a moment long gone is history, not an alarm — so a cron
--     that stopped overnight does not ring the owners about yesterday when it starts again. A critical never expires
--     (0258); it stays in the inbox, unescalated.
-- The brew ladder's own "🔁 Still open" copy (0344) is left as written: it waits 20 or 30 minutes for an alert this
-- marks at ten, so it no longer fires — one line, escalated once. Rewriting the ladder to delete a branch that can no
-- longer run is how a good night breaks something (0336); named here so it is known, not found.
--
-- THE DOOR. The escalation reaches the push function the way every alert does — supabase_functions.http_request, on
-- the alerts table — and the trigger is made from 0157's alerts_push_fanout itself (its call, as the database holds
-- it), so this file carries no address and no key of its own and the two cannot point at different places. Without
-- 0157's trigger there is no door; none is made, and the notice says so.
--
-- ORDER. Deploy the push function first: it learns the UPDATE in the same change. Pasted before it, an escalation is
-- marked and the function in production ignores it — and a marked critical is never sent again.
--
-- existing rows: none restated. A broadcast critical older than thirty minutes was already marked by 0162's run (owner
-- or not), one older than twelve hours is past the window, and the brew ladder's were marked by 0344 or by its own run.
-- The few left — raised in the last half hour, or a brew alarm within the day — are live, and ring on the first run.

create or replace function public.escalate_unacked_criticals() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- A cron job's, across every business: each escalation names its own tenant, and the push function sends it only
  -- to that tenant's people.
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
       and not exists (select 1 from public.alert_reads r where r.alert_id = a.id)
     order by a.created_at
     limit 50
     for update skip locked
  )
  update public.alerts a set escalated_at = now() from due where a.id = due.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.escalate_unacked_criticals() from public, anon, authenticated;

comment on function public.escalate_unacked_criticals() is
  'Every minute (pg_cron escalate-criticals, 0373): marks escalated_at on a critical nobody has acknowledged ten minutes after it was raised (ack_at null and, for a broadcast, no alert_reads row) — every broadcast, and a targeted one that carries escalate_after_min; never a device_test; within twelve hours of being raised. alerts_push_escalation hands the mark to the push function, which sends it once more to its people and every admin and owner of its tenant. Inserts nothing.';

-- The door: 0157's fan-out call, on the moment escalated_at is first set.
do $$
declare v_def text; v_call text;
begin
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
   where t.tgrelid = 'public.alerts'::regclass and t.tgname = 'alerts_push_fanout' and not t.tgisinternal;
  v_call := substring(coalesce(v_def, '') from 'EXECUTE (?:FUNCTION|PROCEDURE) .*$');
  if v_call is null then
    raise notice '0373: public.alerts has no alerts_push_fanout (0157), so an escalation has no way to the push function — none made.';
    return;
  end if;
  execute 'drop trigger if exists alerts_push_escalation on public.alerts';
  execute 'create trigger alerts_push_escalation after update of escalated_at on public.alerts for each row '
       || 'when (old.escalated_at is null and new.escalated_at is not null and new.severity = ''critical'' '
       || 'and new.ack_at is null and new.kind is distinct from ''device_test'') '
       || v_call;
end $$;

do $$ begin perform cron.unschedule('escalate-criticals'); exception when others then null; end $$;
do $$ begin perform cron.schedule('escalate-criticals', '* * * * *', 'select public.escalate_unacked_criticals()'); exception when others then null; end $$;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A critical nobody picks up rings the owners again','fix','Alerts',
   'A critical alert that nobody has picked up ten minutes after it came in is sent once more — "Still open" — to the people it was for and to every owner and admin, as a new notification that rings. Tapping Got it stops it; on an alert for the whole team, anyone tapping it does. Before, it waited half an hour for a lane owner nobody had been given, so no critical ever escalated.',
   '2026-10-11', true),
  ('FYI alerts stay in the inbox','fix','Alerts',
   'An FYI — a new shop order, a sign-up, the daily digest — no longer buzzes anyone''s phone, posts to Teams or sends an email; it waits in the inbox. Important and critical alerts ring as before, and a new reservation or Sunday delivery is important now, so it still rings — once, where it used to come with a second Teams card.',
   '2026-10-11', false),
  ('A locked phone shows what happened, not who','security','Alerts',
   'A notification no longer shows a customer''s name, phone number, address, email or an amount where anyone near the phone can read it — a new order says "New order · 2 items · tap to open", a stalled shop order says just that. The details are in the app, for the crew who are signed in. And each order or alert is its own notification now, so a second one no longer silently replaces the first.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname like 'alerts_push_%';
--     -- two, calling the same function with the same arguments: fan-out on insert, escalation on update of escalated_at
--   select jobname, schedule from cron.job where jobname = 'escalate-criticals';                        -- * * * * *
--   select has_function_privilege('anon', 'public.escalate_unacked_criticals()', 'execute');            -- f
--   select id, title, created_at, escalated_at from public.alerts where severity = 'critical' and escalated_at > now() - interval '1 day';
select public.record_migration('0373_a_critical_nobody_picks_up_rings_the_owners_again');
