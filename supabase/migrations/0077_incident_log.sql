-- 0077 — incident log (field troubleshooting → event recap).
-- When something goes wrong on the ground (generator trips, no hot water, CO2 out, card reader
-- offline, ran out of stock), the crew describes it, the Troubleshoot agent diagnoses it, and we
-- KEEP the record against the event/stop. That's what turns "troubleshoot in the moment" into
-- "event recap that learns" — every incident is recallable, and its prevention items become tasks.

create table if not exists public.incident_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  event_id    uuid references public.events(id) on delete cascade,
  stop_id     uuid references public.stops(id)  on delete cascade,
  symptom     text,                          -- category chip: power | water | gas | pos | stock | other
  problem     text not null,                 -- what the crew described
  diagnosis   jsonb,                         -- { summary, causes[], steps[], prevention[] } from the agent
  severity    text not null default 'issue', -- issue | blocker (blocker = stopped service)
  resolved    boolean not null default false,
  resolved_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- an incident belongs to at most one owner (event XOR stop); a general incident may have neither
  constraint incident_owner_chk check (not (event_id is not null and stop_id is not null))
);

create index if not exists incident_log_event_idx on public.incident_log(event_id) where event_id is not null;
create index if not exists incident_log_stop_idx  on public.incident_log(stop_id)  where stop_id  is not null;
create index if not exists incident_log_recent_idx on public.incident_log(created_at desc);

alter table public.incident_log enable row level security;

-- Small, trusted crew: any staff member can log an incident and read/resolve them. The server
-- (service role) writes the diagnosis; these policies cover the in-app reads + resolve toggle.
create policy incident_read   on public.incident_log for select using (public.is_staff());
create policy incident_insert on public.incident_log for insert with check (public.is_staff());
create policy incident_update on public.incident_log for update using (public.is_staff()) with check (public.is_staff());
