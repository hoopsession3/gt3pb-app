-- 0098 — allow deleting an incident. incident_log had read/insert/update for staff but no DELETE
-- policy, so logged incidents couldn't be removed. Add it (small trusted crew, same is_staff gate).

drop policy if exists incident_delete on public.incident_log;
create policy incident_delete on public.incident_log for delete using (public.is_staff());
