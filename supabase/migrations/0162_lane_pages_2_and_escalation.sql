-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0162 · LANE PAGES II + LANE-OWNER ESCALATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Finish the re-partition: Truck stops leave Plan for Service, Meeting notes leave Plan for
-- Business (Plan is now purely the Events lane: calendar · events · bookings · vendors; the
-- Reserves tab folded into Money as a panel — app-side). Guarded: customized lanes untouched.
update public.work_streams set sections = array_append(sections, 'stops')
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'service' and not ('stops' = any(sections));
update public.work_streams set sections = array_append(sections, 'notes')
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'business' and not ('notes' = any(sections));
-- reading order: the page list should read like the workday (route → readiness → drive)
update public.work_streams set sections = '{now,prep,stops,driver}'
  where tenant_id = '00000000-0000-0000-0000-000000000001' and key = 'service' and sections = '{now,prep,driver,stops}';

-- ── Escalation: a critical broadcast nobody acked in 30 minutes pings the LANE OWNER ────────────
-- R&R made real: work_streams.owner_user_id is accountable, so the ladder routes to them. The
-- escalation is a NEW targeted alert (INSERT is the delivery contract — the 0157 trigger pushes
-- it); the original is stamped escalated_at exactly once, owner assigned or not.
alter table public.alerts add column if not exists escalated_at timestamptz;

create or replace function public.escalate_unacked_criticals() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; own uuid;
begin
  for r in
    select a.id, a.title, a.category, a.link, a.tenant_id
    from public.alerts a
    where a.severity = 'critical' and a.ack_at is null and a.escalated_at is null
      and a.target_user_id is null and a.created_at < now() - interval '30 minutes'
    limit 20
  loop
    select ws.owner_user_id into own from public.work_streams ws
      where ws.tenant_id = r.tenant_id and ws.owner_user_id is not null
        and r.category = any(ws.categories)
      order by ws.sort limit 1;
    if own is not null then
      insert into public.alerts (severity, category, title, body, link, target_user_id)
      values ('critical', r.category, left('Unacked 30m — ' || coalesce(r.title, 'critical alert'), 180),
              'Escalated to you as the lane owner.', r.link, own);
      n := n + 1;
    end if;
    update public.alerts set escalated_at = now() where id = r.id;
  end loop;
  return n;
end $$;

do $$ begin perform cron.unschedule('escalate-criticals'); exception when others then null; end $$;
do $$ begin perform cron.schedule('escalate-criticals', '*/15 * * * *', 'select public.escalate_unacked_criticals()'); exception when others then null; end $$;

-- verify:
--   select key, array_to_string(sections, ',') from public.work_streams order by sort;
--   select count(*) from pg_proc where proname = 'escalate_unacked_criticals';          -- 1
--   select jobname from cron.job where jobname = 'escalate-criticals';                  -- 1 row
