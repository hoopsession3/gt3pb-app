-- 0053 — let the inspection agent PROPOSE compliance rules without trusting them.
-- The agent web-researches a jurisdiction we haven't covered yet and drafts rows; they stay
-- inactive + unverified until a human (admin) approves. Existing seeded rows are researched
-- truth → verified=true by default. Paste into Supabase → SQL Editor → Run. Idempotent.

alter table public.compliance_rules add column if not exists verified boolean not null default true;
alter table public.compliance_rules add column if not exists source text;  -- 'agent-research' | null (manual/seed)

-- Agent proposals are written as active=false, verified=false, source='agent-research'.
-- The app's read paths already filter active=true, so proposals never reach the live checklist
-- or the operator assistant until an admin flips them to active=true, verified=true on approval.

comment on column public.compliance_rules.verified is 'true = human-confirmed (seed/manual). false = agent-proposed, pending approval.';
comment on column public.compliance_rules.source is 'agent-research = drafted by the inspection agent; null = manual/seed.';
