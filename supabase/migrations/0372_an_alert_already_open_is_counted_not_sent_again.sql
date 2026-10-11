-- ── 0372 — AN ALERT ALREADY OPEN IS COUNTED, NOT SENT AGAIN ─────────────────────────────────────────────────────
-- 2026-10-11 (wave 2 of the KDS audit · alerts).
--
-- WHY. alert_open_once (0336) keeps one open line per (kind, subject) for the producers that call it — the pass's
-- waiting alert, the shop-stall watchdog, the uptime check, the office runs. Every other producer is a plain INSERT:
-- the server routes (lib/serverAlerts raiseAlert), the crew's screens (lib/clientAlerts), the brew ladder, the
-- cancel functions. Raising the same thing again while the first was still open wrote a second row, and the INSERT
-- is what fans out (0157): a second line in the inbox, a second push, a second Teams card and, for a critical, a
-- second email. raiseAlertOnce (lib/serverAlerts) asked first, for the webhooks and the error intake; nothing else did.
--
-- WHAT. One rule in the table, for every producer. A raise while an alert with the same key is still open folds
-- into it: occurrences + 1, last_seen_at now (0340: "when this was last true"), and its title, body and link become
-- the latest raise's — alert_open_once's own refresh (0336, 0340). No row is written, so nothing fans out: no push,
-- no Teams, no email. The first raise is a row and rings, as it always did. 0369's re-ring of the pass alert is
-- untouched: it closes the open line before alert_open_once opens the next, so the next is a first raise and rings.
--
-- THE KEY is the business (tenant_id), the kind, the subject, and who the alert is addressed to.
--   · Kind and subject both. A kind says what it is about and a subject which one (0174). An alert with no kind has
--     no key, and is never folded — nothing here matches on a sentence (0336). An alert with a kind and no subject
--     is either a condition about the whole app, whose producer folds it through alert_open_once already, or a
--     one-off with no row to name — a paid order that did not save — and two of those are two orders, each owed its
--     line, so it is not folded either.
--   · Who it is addressed to. One producer writes a line per person, with one kind and subject: a thread reply to
--     each follower, a sign-off request to each approver (app/crew/page.tsx), a proposal to each reviewer
--     (components/ProposalDesk). Each person is owed their own line. A broadcast (no target) is the team's, its own key.
--
-- A LOUDER RAISE IS NOT FOLDED. A critical raised while an fyi about the same thing is open would vanish into the
-- quieter line, unpushed. It closes that line instead (ack_at, ack_by left null — a mechanism, not a person, 0258)
-- and is written, carrying the count: still one open line, and the louder one rings.
--
-- Two raises of one key at the same moment take a transaction lock on the key, so the second sees the first.
-- SECURITY DEFINER: the line a raise folds into can be one the raiser cannot read (a crew member's reply on a
-- leader's thread is addressed to the leader). It reads and writes only a line of the same business, kind, subject
-- and person, and through the API it folds only for someone 0157's insert policy lets raise an alert at all — that
-- policy is checked after this trigger, never for a raise that folds. It runs before 0134's stamp_tenant (triggers
-- fire in name order), so it reads the business the way stamp_tenant writes it: the signed-in raiser's tenant first.
--
-- THE LINES ALREADY OPEN. 0333's lesson: a fix to how rows are written leaves the rows already written as they were.
-- Open lines sharing a key are folded the way the trigger folds a raise: the loudest, newest one stays open and
-- takes the others' counts; the others close by the mechanism and stay for history. Nothing is deleted, no severity
-- is rewritten, and nothing rings: an UPDATE does not fan out.
--
-- Idempotent: run twice, the second run finds no open lines that share a key, and the changelog line is written once.

create or replace function public.alert_severity_rank(p_severity text) returns int
  language sql immutable set search_path = public as $$
  select case p_severity when 'critical' then 3 when 'important' then 2 when 'fyi' then 1 else 2 end
$$;
revoke all on function public.alert_severity_rank(text) from public, anon, authenticated;

create or replace function public.alert_fold_repeat() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_open   public.alerts%rowtype;
begin
  if new.kind is null or new.subject_id is null or new.ack_at is not null then
    return new;
  end if;

  -- WHO MAY FOLD: whoever may raise. Postgres checks an insert against its policy AFTER the row's BEFORE triggers,
  -- and a raise that folds is never inserted — so it would never be checked, and anyone the API lets in could fold a
  -- "raise" into a line they may not raise or even read, rewriting its words (shown in scripts/db.alertwave2.test.mjs
  -- with this check taken out). Through the API (anon, authenticated) only those 0157's insert policy admits fold —
  -- its role list, word for word; anyone else's row goes on to that policy, which refuses it. The server's routes
  -- (service_role), pg_cron and the database's own functions are not the API.
  if coalesce(current_setting('role', true), 'none') in ('anon', 'authenticated')
     and not exists (select 1 from public.profiles p where p.id = auth.uid()
                      and p.role in ('server', 'contractor', 'operator', 'event_manager', 'admin', 'owner')) then
    return new;
  end if;

  -- The business this row will carry: stamp_tenant's rule (0134), the signed-in raiser's tenant first.
  v_tenant := coalesce(public.current_tenant(), new.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid);

  perform pg_advisory_xact_lock(hashtextextended(
    'alert:' || v_tenant::text || ':' || new.kind || ':' || new.subject_id::text || ':' || coalesce(new.target_user_id::text, 'team'), 0));

  select a.* into v_open
    from public.alerts a
   where a.tenant_id = v_tenant
     and a.kind = new.kind
     and a.subject_id = new.subject_id
     and a.target_user_id is not distinct from new.target_user_id
     and a.ack_at is null
   order by a.created_at desc, a.id desc
   limit 1
   for update;
  if not found then
    return new;                                   -- the first raise: written, and it rings (0157)
  end if;

  if public.alert_severity_rank(new.severity) > public.alert_severity_rank(v_open.severity) then
    -- Louder than the open line: that line closes by the mechanism, and this one is written with the count.
    update public.alerts set ack_at = now() where id = v_open.id;
    new.occurrences  := coalesce(v_open.occurrences, 1) + coalesce(new.occurrences, 1);
    new.last_seen_at := now();
    return new;
  end if;

  -- Still the same thing, still open: the line counts it and says the latest words. No row, so no push.
  update public.alerts
     set occurrences  = coalesce(occurrences, 1) + coalesce(new.occurrences, 1),
         last_seen_at = now(),
         title        = coalesce(new.title, title),
         body         = coalesce(new.body, body),
         link         = coalesce(new.link, link)
   where id = v_open.id;
  return null;
end $$;
revoke all on function public.alert_fold_repeat() from public, anon, authenticated;

comment on function public.alert_fold_repeat() is
  'BEFORE INSERT on alerts (0372): a raise with a kind and a subject, while an alert with the same tenant, kind, subject and target is open, folds into it (occurrences + 1, last_seen_at now, latest title/body/link) and writes no row — so nothing fans out. A louder raise closes the open line (ack_at, ack_by null) and is written with the count. No kind or no subject: never folded.';

drop trigger if exists alerts_fold_repeats on public.alerts;
create trigger alerts_fold_repeats before insert on public.alerts
  for each row execute function public.alert_fold_repeat();

-- The lines already open, folded as a raise would be: per key, the loudest and newest stays open with every count.
with open_lines as (
  select a.id, a.occurrences, a.created_at, a.last_seen_at,
         first_value(a.id) over w as keeper,
         row_number() over w as nth
    from public.alerts a
   where a.ack_at is null and a.kind is not null and a.subject_id is not null
  window w as (partition by a.tenant_id, a.kind, a.subject_id, a.target_user_id
               order by public.alert_severity_rank(a.severity) desc, a.created_at desc, a.id desc)
), closed as (
  update public.alerts a set ack_at = now()
    from open_lines o
   where a.id = o.id and o.nth > 1
  returning o.keeper, o.occurrences, greatest(o.created_at, coalesce(o.last_seen_at, o.created_at)) as seen
)
update public.alerts k
   set occurrences  = coalesce(k.occurrences, 1) + f.n,
       last_seen_at = greatest(coalesce(k.last_seen_at, k.created_at), f.seen)
  from (select keeper, sum(coalesce(occurrences, 1))::int as n, max(seen) as seen from closed group by keeper) f
 where k.id = f.keeper;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('An alert that is already open is counted, not sent again','fix','Alerts',
   'When something already waiting in the inbox is raised again before anyone has dealt with it, its line counts it and shows the latest words — no second line, no second push, Teams card or email. A raise that is louder than the line it matches (a critical about something that was only an FYI) still rings, and takes that line''s place. Alerts sent to several people, like a reply to everyone on a thread, stay one line each.',
   '2026-10-11', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select tgname from pg_trigger where tgrelid = 'public.alerts'::regclass and tgname = 'alerts_fold_repeats';   -- one
--   select tenant_id, kind, subject_id, target_user_id, count(*) from public.alerts
--    where ack_at is null and kind is not null and subject_id is not null
--    group by 1, 2, 3, 4 having count(*) > 1;                                                                      -- none
--   select has_function_privilege('authenticated', 'public.alert_fold_repeat()', 'execute');                      -- f
select public.record_migration('0372_an_alert_already_open_is_counted_not_sent_again');
