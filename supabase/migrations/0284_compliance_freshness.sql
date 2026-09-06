-- 0284 — COMPLIANCE RULES GET A DATE, AND TWO OF THEM GET CORRECTED. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Audit step D. The one I have refused to close for weeks, because closing it meant either sourcing
-- the rules or inventing them, and inventing a permit deadline is how someone shows up to an event
-- without a permit.
--
-- I sourced them. Two findings, and one of them would have cost money.
--
--   1. THE FULTON COUNTY DEADLINE IS WRONG IN THE SEED. 0027 says "apply >= 30 days out". The
--      county's own vendor application says thirty (30) BUSINESS days — about six calendar weeks,
--      not four — and adds "Fees may be doubled if submitted after 30 days prior to the event."
--      An operator planning against the seeded rule books the event, applies at four weeks, and
--      pays double. The organizer requirement in the seed is CORRECT: the form states it must be
--      submitted through the event organizer, not by the vendor directly.
--
--   2. THE FOUNDING MARKET HAS NO RULES AT ALL. Every seeded row is GA or universal. Greenville is
--      South Carolina and has been the only live market since day one. And South Carolina moved:
--      retail food establishment permitting now sits with the Department of AGRICULTURE (SCDA),
--      not DHEC. A rule seeded against DHEC would point an operator at the wrong agency.
--
-- WHAT THIS ADDS. The reason D stayed open is that a compliance rule had no way to say WHEN it was
-- last confirmed. A rule with no date is worse than no rule: it looks like knowledge. Every rule now
-- carries verified_on, the authority that says so, and — where it is a deadline — how many days and
-- whether those days are BUSINESS or CALENDAR, because that distinction is the entire finding above.
--
-- WHAT THIS DOES NOT DO. It does not mark anything verified that I could not source to the agency.
-- The South Carolina event-authorization form is recorded as UNVERIFIED with a note saying exactly
-- what to ask SCDA, because the form I found lives on a legacy department's site and may have been
-- superseded by the transfer. lib/compliance.ts already refuses to invent rules for an unseeded
-- jurisdiction; this keeps that promise at the row level too.
--
-- ZERO REGRESSION: every read path selects named columns and filters active = true. New columns are
-- additive and nullable; no existing row's active/verified state changes except the two corrections
-- below, both of which are stated in full.
--
-- Apply after 0283.

-- ── 1. A rule that cannot say when it was checked is not a rule ──────────────────────────────────
alter table public.compliance_rules add column if not exists verified_on date;
alter table public.compliance_rules add column if not exists authority   text;
alter table public.compliance_rules add column if not exists lead_days   int
  check (lead_days is null or lead_days >= 0);
alter table public.compliance_rules add column if not exists lead_basis  text
  check (lead_basis is null or lead_basis in ('business','calendar'));
alter table public.compliance_rules add column if not exists check_note  text;

comment on column public.compliance_rules.verified_on is
  'The date a human last confirmed this against the issuing authority. Null = never confirmed.';
comment on column public.compliance_rules.lead_basis is
  'business or calendar. Fulton County counts BUSINESS days; reading its 30 as calendar days is a doubled fee.';

-- ── 2. The Fulton County correction ──────────────────────────────────────────────────────────────
-- Matched on the old label so this is a correction of the existing row, not a duplicate.
update public.compliance_rules
   set label       = 'Temporary Food Service Permit — submit >= 30 BUSINESS days out (~6 calendar weeks); fees may double if later',
       lead_days   = 30,
       lead_basis  = 'business',
       authority   = 'Fulton County Board of Health, Environmental Health Services',
       verified_on = date '2026-09-06',
       check_note  = 'Confirmed against the county Temporary Event Vendor Application. That form is stamped Revised 8-9-2018 — re-confirm the deadline and the fee before the first Atlanta event.'
 where state = 'GA' and county = 'Fulton' and label like 'Temporary Food Service Permit%';

update public.compliance_rules
   set authority   = 'Fulton County Board of Health, Environmental Health Services',
       verified_on = date '2026-09-06',
       check_note  = 'Confirmed: the vendor application states it must be submitted to the event organizer for submittal to the county, not filed by the vendor directly.'
 where state = 'GA' and county = 'Fulton' and label like 'Permit must go THROUGH%';

-- The food-safety-manager row was never positively sourced — the county form does not mention it
-- either way. It stays visible and stops claiming to be confirmed. This is the honest state: an
-- open question on the checklist beats a confident answer nobody checked.
update public.compliance_rules
   set verified    = false,
       check_note  = 'NOT CONFIRMED. The Fulton temporary vendor application is silent on food-safety-manager certification. Ask the county whether a CFSM must be on site for a temporary event before relying on this.'
 where state = 'GA' and county = 'Fulton' and label like '%food-safety knowledge%';

-- ── 3. The founding market finally gets rules ────────────────────────────────────────────────────
-- Greenville is South Carolina. Inserted by label so a re-run adds nothing.
insert into public.compliance_rules
  (state, county, label, link, kind, critical, sort, active, verified, verified_on, authority, lead_days, lead_basis, check_note)
select v.* from (values
  ('SC', null,
   'Retail Food Establishment Permit — issued by the SC Dept of AGRICULTURE (not DHEC)',
   'https://retailfoodregistration.agriculture.sc.gov/registration',
   'permit', true, 5, true, true, date '2026-09-06',
   'South Carolina Department of Agriculture, Retail Food Safety & Compliance', null, null,
   'Confirmed on the SCDA registration site: a Retail Food Establishment Permit must be obtained from SCDA before selling food retail direct-to-consumer, and mobile establishments (unit plus commissary) are covered. retailfood@scda.sc.gov · 803-896-0640.'),

  ('SC', null,
   'Event authorization for a temporary/mobile setup — CONFIRM the current form and agency with SCDA',
   'https://retailfoodregistration.agriculture.sc.gov/registration',
   'permit', true, 6, true, false, null,
   'South Carolina Department of Agriculture (verify)', 14, 'calendar',
   'NOT CONFIRMED. A DHEC event-authorization form (DHEC 1717, rev 12/2023) recommends submitting 14 days ahead under SC Reg 61-25 — but retail food permitting has since moved to SCDA, so that form may be superseded. Ask SCDA which form applies now and whether 14 days is still the guidance, then set verified_on.'),

  ('SC', 'Greenville', null, null, 'permit', false, 7, false, false, null, null, null, null,
   'Placeholder intentionally left inactive: no Greenville COUNTY-specific rule has been sourced. Nothing county-level should appear on a checklist until someone confirms it exists.')
) as v(state, county, label, link, kind, critical, sort, active, verified, verified_on, authority, lead_days, lead_basis, check_note)
where v.label is not null
  and not exists (select 1 from public.compliance_rules c where c.label = v.label);

-- Everything seeded before today that still claims verified = true, without ever naming an authority
-- or a date, gets the date it was actually confirmed: none. It stays ACTIVE — these are the universal
-- on-site items (display the permit, keep a temperature log) and they are not in doubt — but the
-- freshness view below will now show them for what they are.
update public.compliance_rules
   set check_note = coalesce(check_note, 'Seeded before 0284; never dated. Confirm at the next inspection.')
 where verified_on is null and check_note is null and active;

-- ── 4. Staleness becomes a query ─────────────────────────────────────────────────────────────────
create or replace view public.v_compliance_freshness as
select r.id, r.state, r.county, r.label, r.kind, r.critical, r.active, r.verified,
       r.authority, r.verified_on, r.lead_days, r.lead_basis, r.check_note,
       case when r.verified_on is null then null
            else (current_date - r.verified_on) end as days_since_checked,
       case
         when not r.verified                       then 'UNVERIFIED — do not rely on it without asking the authority'
         when r.verified_on is null                then 'no date — nobody recorded when this was confirmed'
         when current_date - r.verified_on > 365    then 'stale — over a year since it was confirmed'
         when current_date - r.verified_on > 180    then 'ageing — over six months'
         else 'fresh'
       end as freshness
  from public.compliance_rules r
 where r.active
 order by r.critical desc, r.state nulls last, r.county nulls last, r.sort;

revoke all on public.v_compliance_freshness from public, anon;
grant select on public.v_compliance_freshness to authenticated;

comment on view public.v_compliance_freshness is
  'Active compliance rules with how long since anyone confirmed them. freshness <> ''fresh'' is a to-do, not a failure.';

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Permit rules now say who told us, and when','improvement','Compliance',
   'Two corrections and a habit. The Atlanta temporary food permit deadline was recorded as 30 days; the county actually counts 30 business days, roughly six weeks, and can double the fee for a late application — that is fixed. Greenville had no rules on file at all despite being the only market running, and South Carolina has moved retail food permitting to the Department of Agriculture, so the right agency is now recorded. Every rule from here on carries the authority that issued it and the date someone last confirmed it, and anything that has not been confirmed says so plainly instead of looking like settled fact.',
   '2026-09-06', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- what is on the checklist, and how much of it anyone has actually checked:
--   select state, county, freshness, label from public.v_compliance_freshness;
--
--   -- the Fulton deadline now counts business days (expect: 30 / business):
--   select lead_days, lead_basis, verified_on from public.compliance_rules
--    where state = 'GA' and county = 'Fulton' and label like 'Temporary Food Service Permit%';
--
--   -- South Carolina exists now (expect: 2 active rows):
--   select count(*) from public.compliance_rules where state = 'SC' and active;
