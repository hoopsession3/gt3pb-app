-- 0071 — inspection research: TWO-PHASE background so cold-jurisdiction research never hits the
-- maxDuration cap. The single-pass job (0070) still timed out for slow states: web_search + the
-- structured extract together ran past Vercel's 120s function limit, so the `after()` worker was
-- killed mid-run and the job was orphaned at 'running'. We now split the work across two bounded
-- invocations:
--   phase 1 (status 'running' → 'searched'):   web_search the jurisdiction, save the raw findings here.
--   phase 2 (status 'searched' → 'extracting' → 'done'): a second request turns the saved findings
--                                                into the brief + proposed compliance rows.
-- Each phase finishes well under 120s. The Inspection Prep card's poller fires phase 2 the moment it
-- sees 'searched'. Idempotent. Apply after 0070.

alter table public.inspection_research_jobs
  add column if not exists research_raw text;                            -- phase-1 web findings, handed to phase-2 extract

comment on column public.inspection_research_jobs.research_raw is 'Raw web-search findings saved by phase 1; phase 2 extracts the structured brief from this.';

-- Widen the status domain: add the intermediate 'searched' (phase 1 done) and 'extracting' (phase 2 running).
alter table public.inspection_research_jobs
  drop constraint if exists inspection_research_jobs_status_check;
alter table public.inspection_research_jobs
  add constraint inspection_research_jobs_status_check
  check (status in ('pending','running','searched','extracting','done','error'));
