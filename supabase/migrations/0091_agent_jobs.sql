-- 0091 — generic agent jobs. Lets a slow agent (EventPrep's grounded prep-list build) run in the
-- background after the HTTP response is flushed, so the phone never holds a 45-second request open
-- (mobile networks/gateways cut long requests well before the function's maxDuration). The route
-- inserts a job, returns the id, does the work in Next after(), and writes the result here; the client
-- polls this row until status is done/error. Reusable for any future async agent.

create table if not exists public.agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind         text not null,                         -- 'eventprep' | future agents
  status       text not null default 'pending' check (status in ('pending','running','done','error')),
  input        jsonb,                                 -- the request context (owner, notes)
  result       jsonb,                                 -- the agent output when done
  error        text,                                  -- failure message when status = 'error'
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists agent_jobs_recent_idx on public.agent_jobs(created_at desc);

alter table public.agent_jobs enable row level security;
-- staff read (to poll); writes are server-side (service role bypasses RLS)
create policy agent_jobs_read on public.agent_jobs for select using (public.is_staff());
