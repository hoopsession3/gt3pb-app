-- 0070 — inspection research jobs: a queue row per "research this jurisdiction" request so the
-- web-search brief can run in the BACKGROUND instead of inside one HTTP request. The inspection
-- agent route was timing out (~100s) for uncovered states because web_search + several Sonnet
-- calls exceed the serverless/gateway request limit. Now the route inserts a row here, returns the
-- job id immediately, and finishes the research after the response is flushed (Next `after()`);
-- the Inspection Prep card polls this table for the result. Idempotent. Apply after 0069.

create table if not exists public.inspection_research_jobs (
  id           uuid primary key default gen_random_uuid(),
  state        text not null,
  county       text,                                                      -- null = state-wide
  event_id     uuid,                                                      -- optional: drop the checklist onto this event's prep
  place        text not null,                                             -- "Davidson County, TN" — display label
  status       text not null default 'pending' check (status in ('pending','running','done','error')),
  result       jsonb,                                                     -- { researched, summary, checklist, confidence, proposed, tasksAdded } when done
  error        text,                                                      -- failure message when status = 'error'
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists insp_jobs_recent on public.inspection_research_jobs(created_at desc);

alter table public.inspection_research_jobs enable row level security;

-- Staff read (same audience as compliance_rules — the card lives in /admin and polls this by id).
-- No authenticated write policy: the route + background worker write via the service-role key,
-- which bypasses RLS, so the browser can never forge or mutate a job.
drop policy if exists "insp jobs staff read" on public.inspection_research_jobs;
create policy "insp jobs staff read" on public.inspection_research_jobs for select using (public.is_staff());

comment on table public.inspection_research_jobs is 'Background queue for the inspection agent web-research path; the route writes here and the Inspection Prep card polls for the result.';
comment on column public.inspection_research_jobs.result is 'Set once on completion: { researched, summary, checklist, confidence, proposed[], tasksAdded }.';
