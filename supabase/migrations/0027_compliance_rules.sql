-- 0027 — compliance research database. The app PULLS event-prep permit/cert requirements
-- from here by jurisdiction (state/county) instead of hardcoding them, and it grows: add
-- a row for a new city and every future event there auto-gets the right checklist.
-- state NULL = universal (every event); county NULL = applies state-wide.

create table if not exists public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  state text,
  county text,
  label text not null,
  link text,
  kind text not null default 'permit' check (kind in ('permit', 'cert', 'inspection', 'insurance', 'other')),
  critical boolean not null default false,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.compliance_rules enable row level security;
drop policy if exists "compliance read" on public.compliance_rules;
create policy "compliance read" on public.compliance_rules for select using (public.is_staff());
drop policy if exists "compliance admin write" on public.compliance_rules;
create policy "compliance admin write" on public.compliance_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed: GA / Fulton (researched from Fulton County BOH + GA DPH, Jun 2026) + GA state-wide
-- + universal on-site inspection items. Add more jurisdictions as rows over time.
insert into public.compliance_rules (state, county, label, link, kind, critical, sort) values
  ('GA', 'Fulton', 'Temporary Food Service Permit — apply >= 30 days out', 'https://www.fultoncountyga.gov/-/media/Departments/Board-of-Health/Environmental-Health/Restaurant-Inspection/Link-List-Items/Temporary-Event-Vendor-Application.pdf', 'permit', true, 10),
  ('GA', 'Fulton', 'Permit must go THROUGH the event organizer (no solo curb setup)', 'https://fultoncountyboh.com/environmental-health/food-service/', 'permit', true, 11),
  ('GA', 'Fulton', 'Person-in-charge food-safety knowledge (ServSafe / CFSM — recommended, not required for temp)', 'https://www.agr.georgia.gov/certified-food-protection-managers', 'cert', false, 12),
  ('GA', 'Fulton', 'Call Fulton County Board of Health to confirm for the date', 'https://fultoncountyboh.com/environmental-health/food-service/', 'permit', false, 13),
  ('GA', null, 'Temporary Food Service Permit — county health dept, >= 30 days out', 'https://dph.georgia.gov/environmental-health/food-service', 'permit', true, 20),
  (null, null, 'Permit + inspection report displayed on site', null, 'inspection', false, 90),
  (null, null, 'Hot / cold holding thermometer + temp log', null, 'inspection', false, 91);
