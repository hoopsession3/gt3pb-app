-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0265 · THE PIPELINE MOVES ONTO THE PLAYBOOK ENUM (2026-08-03 — GT3 Command build P2)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Playbook v1 §09 declares the stages "on the app enum": LEAD → WARM → SAMPLED → PILOT → LIVE →
-- EXPAND. The app predates the doc and ran prospect → first_attempt → talking → proposal →
-- won/lost — a close-the-deal model that cannot express what this business actually is: a LIVE
-- cooler account is not "won and done," it is operating and should EXPAND. The partner-lifecycle
-- enum wins; `lost` stays as the terminal for pursuits that die.
--
-- Migration map (applied to existing rows): prospect→lead · first_attempt→warm · talking→warm ·
-- proposal→sampled · won→live. won_at keeps its meaning (stamped when an account goes live).
-- New columns from the Playbook's Account object: mrr_cents (recurring $ once live) and
-- priority (P1–P4 — any lead can outrank its category), plus category (the doc's CAT tags).
-- Idempotent; apply after 0264.

-- 1) widen the check so both vocabularies are momentarily legal, migrate, then lock the new law
alter table public.opportunities drop constraint if exists opportunities_stage_check;

update public.opportunities set stage = case stage
  when 'prospect'      then 'lead'
  when 'first_attempt' then 'warm'
  when 'talking'       then 'warm'
  when 'proposal'      then 'sampled'
  when 'won'           then 'live'
  else stage end
 where stage in ('prospect','first_attempt','talking','proposal','won');

alter table public.opportunities add constraint opportunities_stage_check
  check (stage in ('lead','warm','sampled','pilot','live','expand','lost'));
alter table public.opportunities alter column stage set default 'lead';

-- 2) the Account fields the Playbook's KPI framework reads
alter table public.opportunities add column if not exists mrr_cents int;             -- recurring $/mo once LIVE (MRR-by-account KPI)
alter table public.opportunities add column if not exists priority  text;
alter table public.opportunities drop constraint if exists opportunities_priority_check;
alter table public.opportunities add constraint opportunities_priority_check
  check (priority is null or priority in ('P1','P2','P3','P4'));
alter table public.opportunities add column if not exists category  text;            -- the doc's CAT tag (WHSL+PRTNR, RETAIL, …)

-- Verify (prod, after apply):
--   select count(*) from public.opportunities where stage in ('prospect','first_attempt','talking','proposal','won');  -- 0
--   select conname from pg_constraint where conname = 'opportunities_stage_check';                                     -- exists
--   select column_default from information_schema.columns where table_name='opportunities' and column_name='stage';    -- 'lead'
