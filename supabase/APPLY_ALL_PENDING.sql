-- ⚠️ NEVER include files from supabase/pending/ in this bundle — those are soak-gated (see
-- supabase/pending/0224_field_ops_contract.sql) and applying them early is irreversible.
--
-- ── GENERATED FILE — DO NOT EDIT BY HAND ─────────────────────────────────────────────────────
-- Regenerate with:  npm run migrations:pending -- --write
--
-- This file is the OUTPUT of comparing supabase/migrations/ against what production's ledger
-- (public.schema_migrations, via /api/migrations) says has actually been applied. Its previous
-- hand-maintained version said "apply all pending migrations" and stopped at 0035 while this
-- directory held 326 files — wrong by 291 migrations, referenced by nothing, checked by nothing.
--
-- The line below is what stops that happening again: scripts/drift.check.mjs fails the release
-- if supabase/migrations/ ever holds a migration numbered above it.
-- pending-from: 0356
-- generated-at: 2026-10-07
-- pending-count: 1
-- ledger-read-from: https://app.gt3pb.com/api/migrations
-- ============================================================
-- 0356_the_weekly_run_comes_from_the_program.sql
-- ============================================================
-- 0356 — THE WEEKLY RUN COMES FROM THE PROGRAM. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Phase 1, part 2 of the B2B challenge report (2026-10-07, the Scheduling section; defects 4, 7 and 9).
-- 0355 gave every weekly order a program. This makes the program the thing deliveries come from:
--
--   A RULE, NOT "WEEKLY". A program is every n weeks (1 = weekly, 2 = every other week) on one or more
--   weekdays, from an anchor date, with optional start and end dates — or the nth weekday of the month
--   (the foundation; its screen comes later). Today's programs read as they were: weekly, Mondays.
--
--   ONE DELIVERY PER PROGRAM PER DATE, BY CONSTRUCTION. Each generated order records the program date
--   it fills (scheduled_for), and (program_id, scheduled_for) is unique, so running the generator any
--   number of times — the nightly job, the crew's button, a booking — makes each delivery once. A
--   date that was decided (delivered, canceled by the crew, skipped for a pause) is never made again:
--   the old generator re-created a canceled standing order on the next run.
--
--   CUTOFFS IN THE MARKET'S TIME. Every delivery stores the moment changes close: 6 PM on the last
--   weekday before it, in its market's time zone (markets.timezone, read for the first time) — the
--   Friday 6 PM before a Monday, across both daylight-saving weekends. "Next Monday" stops depending
--   on whose clock asked: the booking route computed it in the server's zone (UTC on Vercel), so on
--   a Sunday evening in Greenville it booked the Monday after next, and the crew's button computed it
--   in the phone's.
--
--   A DATE BELONGS TO A PROGRAM THAT WAS ON BEFORE ITS CUTOFF. A program switched on after Friday 6 PM
--   starts the Monday after; one paused after the cutoff still gets that Monday (it is brewed). A
--   generated delivery nobody has touched follows the program until its cutoff: a pause takes it off
--   (kept, marked why — not deleted), a resume puts it back, a new gallons figure changes it, a new
--   door, window or price reaches it (the program's, the door's, the city's or Settings'), and a new
--   rule takes off the dates it no longer makes and makes its own. Paid, invoiced, linked to a Square
--   payment, in progress, or past its cutoff, it is never changed (office_untouched, one definition).
--
--   THE WINDOW FROM THE PLACE. The program's window, else the location's, else the market's office
--   window — defect 4: every account carried 'mon_0500_0800' by default, so Atlanta's 6–9 AM never won.
--
--   CLOSED DATES. GT3's (a market, or everywhere) and a company's own: skip the delivery, or move it to
--   the next open weekday. The generator applies them; nobody cleans up after Thanksgiving.
--
--   A SCHEDULE THAT RUNS ITSELF, AND SAYS WHEN IT DIDN'T. An hourly job does each market's run once a
--   day after 3 AM its own time (pg_cron runs in UTC), seven days ahead — the week the crew already
--   plans. Every run, the crew's included, writes a job_runs row; a failure raises one critical alert.
--   Seven days, not the report's six weeks, on purpose: today revenue (report_sales and the digests)
--   counts an office order by when it was created, and the crew's route lists every open order — six
--   weeks of future rows would move revenue weeks early and bury next Monday. The horizon is one
--   function, office_horizon(); it grows when those readers count by delivery date (Phase 2).
--
-- KEPT WORKING: generate_office_route(date) — the crew's button and its tests — makes that date's
-- deliveries from the programs, the same answer as before for Mondays. The old office orders keep
-- every value; the ones a standing account made are given their program date, the earliest per date
-- where two were made (reported, never changed).
--
-- changelog: below.

-- ── 1 · the rule, on the program ──────────────────────────────────────────────────────────────────
alter table public.company_programs add column if not exists every_n_weeks smallint not null default 1;
alter table public.company_programs add column if not exists weekdays smallint[] not null default '{1}';
alter table public.company_programs add column if not exists anchor_date date;
alter table public.company_programs add column if not exists monthly_nth smallint;
alter table public.company_programs add column if not exists delivery_window text;
alter table public.company_programs add column if not exists starts_on date;
alter table public.company_programs add column if not exists ends_on date;
alter table public.company_programs add column if not exists price_per_gallon_cents integer;
alter table public.company_programs add column if not exists active_since timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_programs_rule_ok') then
    alter table public.company_programs add constraint company_programs_rule_ok check (
      every_n_weeks between 1 and 8
      and cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]
      and (monthly_nth is null or monthly_nth in (-1, 1, 2, 3, 4))
      and (ends_on is null or starts_on is null or ends_on >= starts_on)
      and (price_per_gallon_cents is null or price_per_gallon_cents > 0));
  end if;
end $$;
comment on column public.company_programs.weekdays is 'ISO weekdays the program delivers on (1 = Monday … 7 = Sunday).';
comment on column public.company_programs.monthly_nth is 'With a value, the program delivers on the nth of its weekday in each month (-1 = the last) instead of every n weeks. The foundation; no screen sets it yet.';
comment on column public.company_programs.active_since is 'When the program last went active. A delivery date belongs to it only if this is before that date''s cutoff.';

-- When a program goes active, it says so (and a pause leaves the old moment for the record).
create or replace function public.company_program_active_since() returns trigger
language plpgsql as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.active_since := now();
  end if;
  return new;
end $$;
drop trigger if exists company_program_active_since_tg on public.company_programs;
create trigger company_program_active_since_tg
  before insert or update of status on public.company_programs
  for each row execute function public.company_program_active_since();

-- Programs that are on now have been on since their account was made.
update public.company_programs p
   set active_since = coalesce((select min(a.created_at) from public.business_accounts a where a.program_id = p.id), p.created_at)
 where p.status = 'active' and p.active_since is null;

-- ── 2 · the delivery remembers its program date, its cutoff, and why it was taken off ─────────────
alter table public.business_orders add column if not exists scheduled_for date;
alter table public.business_orders add column if not exists cutoff_at timestamptz;
alter table public.business_orders add column if not exists canceled_reason text;
comment on column public.business_orders.scheduled_for is 'The program date this delivery fills (0356). A move changes delivery_date and keeps this, so the generator never makes the date again.';
comment on column public.business_orders.cutoff_at is 'When changes to this delivery close: 6 PM market time on the last weekday before it (0356).';

-- The orders standing accounts already made get their program date — the earliest per program and
-- date where the old generator or a re-booking made two. The rest stay as they are, and are counted.
do $$
declare dup int;
begin
  update public.business_orders o
     set scheduled_for = o.delivery_date
   where o.program_id is not null and o.standing and o.scheduled_for is null
     and o.id = (select o2.id from public.business_orders o2
                  where o2.program_id = o.program_id and o2.delivery_date = o.delivery_date and o2.standing
                  order by (o2.canceled_at is null) desc, o2.created_at, o2.id
                  limit 1)
     and not exists (select 1 from public.business_orders o3
                      where o3.program_id = o.program_id and o3.scheduled_for = o.delivery_date);
  select count(*) into dup from public.business_orders where program_id is not null and standing and scheduled_for is null;
  if dup > 0 then
    raise notice '0356: % standing order(s) were a second order for a date their program already had — left as they are', dup;
  end if;
end $$;
create unique index if not exists business_orders_program_date on public.business_orders (program_id, scheduled_for);

-- ── 3 · closed dates ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.office_closed_dates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid references public.companies(id),   -- the company's own closure; null = GT3's
  market      text,                                   -- GT3's closure in one market; null = every market
  starts_on   date not null,
  ends_on     date not null,
  policy      text not null default 'skip' check (policy in ('skip', 'next_business_day')),
  note        text,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists office_closed_dates_span on public.office_closed_dates (tenant_id, starts_on, ends_on);
alter table public.office_closed_dates enable row level security;
drop policy if exists "office closed dates staff" on public.office_closed_dates;
create policy "office closed dates staff" on public.office_closed_dates for all
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "office closed dates member read" on public.office_closed_dates;
create policy "office closed dates member read" on public.office_closed_dates for select
  using (company_id is not null and public.is_company_member(company_id));
drop trigger if exists stamp_tenant_tg on public.office_closed_dates;
create trigger stamp_tenant_tg before insert on public.office_closed_dates for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.office_closed_dates;
create policy "tenant isolation" on public.office_closed_dates as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
revoke all on public.office_closed_dates from public, anon;
grant select, insert, update, delete on public.office_closed_dates to authenticated;
comment on table public.office_closed_dates is
  'Dates office deliveries do not happen (0356): GT3''s (a market, or every market) or a company''s own. skip drops the delivery; next_business_day moves it to the next open weekday.';

-- ── 4 · the job log ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  job         text not null,
  market      text,
  run_on      date not null,                    -- the market's own date
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  made        integer,
  error       text,
  run_by      uuid references auth.users(id) on delete set null   -- null = the schedule
);
create index if not exists job_runs_recent on public.job_runs (tenant_id, job, market, run_on desc);
alter table public.job_runs enable row level security;
drop policy if exists "job runs staff read" on public.job_runs;
create policy "job runs staff read" on public.job_runs for select using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.job_runs;
create policy "tenant isolation" on public.job_runs as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
revoke all on public.job_runs from public, anon;
revoke insert, update, delete, truncate on public.job_runs from authenticated;
grant select on public.job_runs to authenticated;
comment on table public.job_runs is
  'One row per run of a scheduled job (0356: office_generation) — the schedule''s and the crew''s — with what it made or why it failed.';

-- ── 5 · the rule, the clock, the place, the price ────────────────────────────────────────────────
create or replace function public.office_horizon() returns int
language sql immutable as $$ select 7 $$;
comment on function public.office_horizon() is 'How many days ahead office deliveries are generated (0356). One home: the nightly job, the crew''s button and a booking all read it.';

create or replace function public.office_tz(p_market text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select m.timezone from public.markets m where m.slug = p_market), 'America/New_York')
$$;

create or replace function public.office_local_today(p_market text) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone public.office_tz(p_market))::date
$$;

-- 6 PM, market time, on the last weekday before the delivery.
create or replace function public.office_cutoff(p_date date, p_market text) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare d date := p_date - 1;
begin
  while extract(isodow from d) > 5 loop d := d - 1; end loop;
  return (d + time '18:00') at time zone public.office_tz(p_market);
end $$;

create or replace function public.office_rule_matches(p public.company_programs, d date) returns boolean
language plpgsql immutable as $$
declare anchor date; weeks int;
begin
  if p.starts_on is not null and d < p.starts_on then return false; end if;
  if p.ends_on is not null and d > p.ends_on then return false; end if;
  if not (extract(isodow from d)::smallint = any (p.weekdays)) then return false; end if;
  if p.monthly_nth is not null then
    if p.monthly_nth = -1 then return extract(month from d + 7) <> extract(month from d); end if;
    return ((extract(day from d)::int - 1) / 7) + 1 = p.monthly_nth;
  end if;
  if p.every_n_weeks > 1 then
    anchor := coalesce(p.anchor_date, p.starts_on, (p.created_at at time zone 'UTC')::date);
    weeks := ((d - (extract(isodow from d)::int - 1)) - (anchor - (extract(isodow from anchor)::int - 1))) / 7;
    if weeks % p.every_n_weeks <> 0 then return false; end if;
  end if;
  return true;
end $$;

-- 'skip', 'next_business_day', or null when the date is open. A skip wins over a move.
create or replace function public.office_closure(p_tenant uuid, p_company uuid, p_market text, d date) returns text
language sql stable security definer set search_path = public as $$
  select c.policy from public.office_closed_dates c
   where c.tenant_id = p_tenant and d between c.starts_on and c.ends_on
     and (c.company_id = p_company or (c.company_id is null and (c.market is null or c.market = p_market)))
   order by (c.policy = 'skip') desc
   limit 1
$$;

create or replace function public.office_window(p public.company_programs) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(p.delivery_window,
                  (select l.delivery_window from public.company_locations l where l.id = p.location_id),
                  (select m.office_window from public.markets m where m.slug = p.market),
                  'mon_0500_0800')
$$;

create or replace function public.office_price(p public.company_programs) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(p.price_per_gallon_cents, (select ls.office_price_cents from public.live_status ls where ls.id = 1), 4500)
$$;

-- ── 6 · one delivery for one program date ────────────────────────────────────────────────────────
-- Returns the new order's id, or null when the date already has one (made, delivered, canceled or
-- skipped for a pause — decided either way), is closed, or the program has under 3 gallons.
create or replace function public.office_make_delivery(p public.company_programs, d date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_policy text; v_date date := d; v_gal numeric; v_ppg int; v_id uuid; v_tries int := 0;
  loc public.company_locations; co public.companies; acct public.business_accounts;
begin
  if exists (select 1 from public.business_orders o
              where o.program_id = p.id
                and (o.scheduled_for = d or (o.scheduled_for is null and o.delivery_date = d and o.canceled_at is null))) then
    return null;
  end if;
  v_policy := public.office_closure(p.tenant_id, p.company_id, p.market, d);
  if v_policy = 'skip' then return null; end if;
  if v_policy = 'next_business_day' then
    loop
      v_date := v_date + 1; v_tries := v_tries + 1;
      exit when v_tries > 14;
      continue when extract(isodow from v_date) > 5;
      exit when public.office_closure(p.tenant_id, p.company_id, p.market, v_date) is null;
    end loop;
    if v_tries > 14 then return null; end if;
  end if;

  select coalesce(sum(l.quantity), 0) into v_gal from public.company_program_lines l
   where l.program_id = p.id and l.product = 'cold_brew_gallon';
  if v_gal < 3 then return null; end if;
  v_ppg := public.office_price(p);
  select * into loc from public.company_locations where id = p.location_id;
  select * into co from public.companies where id = p.company_id;
  select * into acct from public.business_accounts where program_id = p.id order by created_at limit 1;

  insert into public.business_orders (
    tenant_id, business_id, user_id, company, contact_name, contact_phone,
    address_street, address_city, address_zip, access_instructions, delivery_date, delivery_window,
    gallons, price_per_gallon_cents, subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
    billing_terms, standing, market, company_id, location_id, program_id, scheduled_for, cutoff_at
  ) values (
    p.tenant_id, acct.id, acct.user_id, co.name, coalesce(loc.contact_name, acct.contact_name), coalesce(loc.contact_phone, acct.contact_phone),
    coalesce(loc.address_street, ''), coalesce(loc.address_city, ''), coalesce(loc.address_zip, ''), loc.access_instructions,
    v_date, public.office_window(p),
    v_gal, v_ppg, (v_gal * v_ppg)::int, 0, 0, (v_gal * v_ppg)::int,
    co.billing_terms, true, loc.market, p.company_id, p.location_id, p.id, d, public.office_cutoff(v_date, loc.market)
  )
  on conflict (program_id, scheduled_for) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Every active program's deliveries from p_from (default: tomorrow in its market) through p_through,
-- for one tenant (and one market, or one program). A date belongs to a program only if it was on
-- before that date's cutoff.
create or replace function public.office_generate(p_tenant uuid, p_market text, p_through date, p_program uuid default null, p_from date default null)
returns int
language plpgsql security definer set search_path = public as $$
declare p public.company_programs; d date; n int := 0;
begin
  for p in
    select * from public.company_programs
     where status = 'active' and tenant_id = p_tenant
       and (p_market is null or market = p_market) and (p_program is null or id = p_program)
  loop
    for d in select g::date from generate_series(coalesce(p_from, public.office_local_today(p.market) + 1), p_through, interval '1 day') g loop
      continue when not public.office_rule_matches(p, d);
      continue when p.active_since is not null and p.active_since > public.office_cutoff(d, p.market);
      if public.office_make_delivery(p, d) is not null then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

-- ── 7 · who runs it ──────────────────────────────────────────────────────────────────────────────
-- The schedule: hourly, and each market once a day after 3 AM its own time. p_now is for the tests;
-- the schedule passes nothing. A market whose run fails is logged and alerted, and the others still run.
create or replace function public.run_office_generation(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_local timestamp; v_today date; v_job uuid; v_made int; v_total int := 0;
begin
  for r in select distinct p.tenant_id, p.market from public.company_programs p where p.status = 'active' loop
    v_job := null;
    begin
      v_local := p_now at time zone public.office_tz(r.market);
      continue when extract(hour from v_local) < 3;
      v_today := v_local::date;
      continue when exists (select 1 from public.job_runs j
                             where j.tenant_id = r.tenant_id and j.job = 'office_generation' and j.market = r.market
                               and j.run_on = v_today and j.ok and j.run_by is null);
      insert into public.job_runs (tenant_id, job, market, run_on) values (r.tenant_id, 'office_generation', r.market, v_today)
      returning id into v_job;
      v_made := public.office_generate(r.tenant_id, r.market, v_today + public.office_horizon(), null, v_today + 1);
      update public.job_runs set finished_at = now(), ok = true, made = v_made where id = v_job;
      v_total := v_total + v_made;
    exception when others then
      -- the block's own writes are undone, the log row with them; the failure gets a row of its own
      insert into public.job_runs (tenant_id, job, market, run_on, finished_at, ok, error)
      values (r.tenant_id, 'office_generation', r.market, (p_now at time zone 'UTC')::date, now(), false, left(sqlerrm, 500));
      perform public.alert_open_once(
        'office_generation_failed', md5(r.tenant_id::text || ':' || r.market)::uuid, 'critical', 'system',
        left('Office deliveries didn''t generate — ' || r.market, 180),
        'The nightly run that makes office deliveries from their programs failed: ' || left(sqlerrm, 300)
          || '. Press Generate on the office route to make this week''s, then look at the job log.',
        '/crew?s=now');
    end;
  end loop;
  return v_total;
end $$;
-- existing rows: run_office_generation — a new producer; it has never written an alert.
revoke all on function public.run_office_generation(timestamptz) from public, anon, authenticated;

do $$ begin
  perform cron.schedule('office-generation', '7 * * * *', 'select public.run_office_generation()');
exception when others then null; end $$;

-- The crew's button: this tenant's deliveries through the horizon, every market, logged.
create or replace function public.generate_office_deliveries() returns int
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.effective_tenant(); m text; v_job uuid; v_made int; v_total int := 0;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  for m in select distinct market from public.company_programs where tenant_id = v_tenant and status = 'active' loop
    insert into public.job_runs (tenant_id, job, market, run_on, run_by)
    values (v_tenant, 'office_generation', m, public.office_local_today(m), auth.uid())
    returning id into v_job;
    v_made := public.office_generate(v_tenant, m, public.office_local_today(m) + public.office_horizon());
    update public.job_runs set finished_at = now(), ok = true, made = v_made where id = v_job;
    v_total := v_total + v_made;
  end loop;
  return v_total;
end $$;
revoke all on function public.generate_office_deliveries() from public, anon;
grant execute on function public.generate_office_deliveries() to authenticated;

-- KEPT: the crew's old button and its tests. That date's deliveries for this tenant's programs whose
-- rule includes it — an explicit date from staff, so it is made even when its cutoff has passed.
create or replace function public.generate_office_route(p_date date)
returns int
language plpgsql security definer set search_path = public as $$
declare p public.company_programs; n int := 0;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  for p in select * from public.company_programs where status = 'active' and tenant_id = public.effective_tenant() loop
    continue when not public.office_rule_matches(p, p_date);
    if public.office_make_delivery(p, p_date) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- A booking (service role): the account's program makes its deliveries, and the first one a booking
-- made now can still change — the next rule date whose cutoff is ahead — comes back to the route.
create or replace function public.book_office_standing(p_account uuid)
returns table (order_id uuid, delivery_date date, total_cents int, cutoff_at timestamptz, delivery_window text)
language plpgsql security definer set search_path = public as $$
declare p public.company_programs; d date; v_tries int := 0;
begin
  select cp.* into p from public.company_programs cp join public.business_accounts a on a.program_id = cp.id where a.id = p_account;
  if p.id is null or p.status <> 'active' then return; end if;
  d := public.office_local_today(p.market) + 1;
  loop
    v_tries := v_tries + 1;
    if v_tries > 120 then return; end if;
    exit when public.office_rule_matches(p, d) and public.office_cutoff(d, p.market) > now()
          and coalesce(public.office_closure(p.tenant_id, p.company_id, p.market, d), '') <> 'skip';
    d := d + 1;
  end loop;
  perform public.office_generate(p.tenant_id, p.market, greatest(d, public.office_local_today(p.market) + public.office_horizon()), p.id, d);
  return query
    select o.id, o.delivery_date, o.total_cents, o.cutoff_at, o.delivery_window from public.business_orders o
     where o.program_id = p.id and (o.scheduled_for = d or (o.scheduled_for is null and o.delivery_date = d and o.canceled_at is null))
     order by o.created_at limit 1;
end $$;
revoke all on function public.book_office_standing(uuid) from public, anon, authenticated;
grant execute on function public.book_office_standing(uuid) to service_role;

-- A one-off booking: the next date the market's office window falls on whose cutoff is ahead.
create or replace function public.office_next_delivery(p_market text)
returns table (delivery_date date, cutoff_at timestamptz, delivery_window text)
language plpgsql stable security definer set search_path = public as $$
declare w text; dow int; d date; v_tries int := 0;
begin
  w := coalesce((select m.office_window from public.markets m where m.slug = p_market), 'mon_0500_0800');
  dow := coalesce(array_position(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], left(w, 3)), 1);
  d := public.office_local_today(p_market) + 1;
  loop
    v_tries := v_tries + 1;
    exit when v_tries > 30;
    exit when extract(isodow from d) = dow and public.office_cutoff(d, p_market) > now()
          and coalesce(public.office_closure(public.effective_tenant(), null, p_market, d), '') <> 'skip';
    d := d + 1;
  end loop;
  return query select d, public.office_cutoff(d, p_market), w;
end $$;
revoke all on function public.office_next_delivery(text) from public, anon;
grant execute on function public.office_next_delivery(text) to authenticated, service_role;

-- ── 8 · an untouched delivery follows its program until its cutoff ───────────────────────────────
-- Untouched: generated (it has a cutoff), not canceled, still received and unpaid, no Square link,
-- not past its cutoff. Anything else is a decision someone made, and stays. One definition, read by
-- every follower below, so the day a client's own change to a delivery counts as a decision (Phase
-- 2), it changes here and nowhere else.
create or replace function public.office_untouched(o public.business_orders) returns boolean
language sql stable as $$
  select o.canceled_at is null and o.status = 'received' and o.payment_status = 'pending'
     and o.paylink_url is null and o.square_order_id is null and coalesce(o.cutoff_at > now(), false)
$$;

create or replace function public.office_program_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_from date;
begin
  if tg_table_name = 'company_programs' then
    if old.status = 'active' and new.status <> 'active' then
      update public.business_orders o
         set canceled_at = now(), canceled_reason = case when new.status = 'paused' then 'paused' else 'program ended' end
       where o.program_id = new.id and public.office_untouched(o);
    elsif new.status = 'active' and old.status is distinct from 'active' then
      update public.business_orders set canceled_at = null, canceled_reason = null
       where program_id = new.id and canceled_reason = 'paused' and canceled_at is not null and cutoff_at > now();
      perform public.office_generate(new.tenant_id, new.market, public.office_local_today(new.market) + public.office_horizon(), new.id);
    elsif new.status = 'active' then
      -- THE RULE, THE WINDOW OR THE PRICE CHANGED while the program stayed on. An untouched delivery
      -- the new rule no longer makes is taken off ('schedule changed', kept as the record); one a
      -- change took off that the rule makes again comes back; the rest take the program's window and
      -- price; then the new rule's dates whose cutoff is still ahead are made. Without this, a Monday
      -- program moved to Thursdays kept its Monday and gained a Thursday — both delivered.
      update public.business_orders o set canceled_at = now(), canceled_reason = 'schedule changed'
       where o.program_id = new.id and public.office_untouched(o) and not public.office_rule_matches(new, o.scheduled_for);
      update public.business_orders o set canceled_at = null, canceled_reason = null
       where o.program_id = new.id and o.canceled_reason = 'schedule changed' and o.canceled_at is not null
         and o.status = 'received' and o.payment_status = 'pending' and o.paylink_url is null and o.square_order_id is null
         and o.cutoff_at > now() and public.office_rule_matches(new, o.scheduled_for);
      update public.business_orders o
         set delivery_window = public.office_window(new), price_per_gallon_cents = public.office_price(new),
             subtotal_cents = (o.gallons * public.office_price(new))::int,
             total_cents = (o.gallons * public.office_price(new))::int + o.delivery_fee_cents + o.tax_cents
       where o.program_id = new.id and public.office_untouched(o)
         and (o.delivery_window, o.price_per_gallon_cents) is distinct from (public.office_window(new), public.office_price(new));
      v_from := public.office_local_today(new.market) + 1;
      while public.office_cutoff(v_from, new.market) <= now() loop v_from := v_from + 1; end loop;
      perform public.office_generate(new.tenant_id, new.market, public.office_local_today(new.market) + public.office_horizon(), new.id, v_from);
    end if;
  elsif tg_table_name = 'company_program_lines' then
    if new.product = 'cold_brew_gallon' and new.quantity is distinct from old.quantity then
      update public.business_orders o
         set gallons = new.quantity,
             subtotal_cents = (new.quantity * o.price_per_gallon_cents)::int,
             total_cents = (new.quantity * o.price_per_gallon_cents)::int + o.delivery_fee_cents + o.tax_cents
       where o.program_id = new.program_id and public.office_untouched(o);
    end if;
  elsif tg_table_name = 'company_locations' then
    update public.business_orders o
       set address_street = coalesce(new.address_street, ''), address_city = coalesce(new.address_city, ''),
           address_zip = coalesce(new.address_zip, ''), access_instructions = new.access_instructions,
           delivery_window = public.office_window(p)
      from public.company_programs p
     where p.id = o.program_id and o.location_id = new.id and public.office_untouched(o);
  elsif tg_table_name = 'live_status' then
    -- Settings' price. The programs without a price of their own bill it, so their untouched
    -- deliveries do too: /office quotes Settings' price, and the delivery it quotes must bill the same.
    if new.office_price_cents is distinct from old.office_price_cents then
      update public.business_orders o
         set price_per_gallon_cents = coalesce(new.office_price_cents, 4500),
             subtotal_cents = (o.gallons * coalesce(new.office_price_cents, 4500))::int,
             total_cents = (o.gallons * coalesce(new.office_price_cents, 4500))::int + o.delivery_fee_cents + o.tax_cents
        from public.company_programs p
       where p.id = o.program_id and p.price_per_gallon_cents is null and public.office_untouched(o);
    end if;
  elsif tg_table_name = 'markets' then
    -- A city's office window: the programs with no window of their own, or on their door, take it.
    if new.office_window is distinct from old.office_window then
      update public.business_orders o set delivery_window = public.office_window(p)
        from public.company_programs p
       where p.id = o.program_id and p.market = new.slug and public.office_untouched(o)
         and o.delivery_window is distinct from public.office_window(p);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.office_program_follow() from public, anon, authenticated;
revoke all on function public.office_untouched(public.business_orders) from public, anon;

drop trigger if exists office_program_follow_tg on public.company_programs;
create trigger office_program_follow_tg
  after update of status, every_n_weeks, weekdays, anchor_date, monthly_nth, starts_on, ends_on, delivery_window, price_per_gallon_cents
  on public.company_programs
  for each row execute function public.office_program_follow();
drop trigger if exists office_program_line_follow_tg on public.company_program_lines;
create trigger office_program_line_follow_tg after update of quantity on public.company_program_lines
  for each row execute function public.office_program_follow();
drop trigger if exists office_location_follow_tg on public.company_locations;
create trigger office_location_follow_tg
  after update of address_street, address_city, address_zip, access_instructions, delivery_window on public.company_locations
  for each row execute function public.office_program_follow();
drop trigger if exists office_price_follow_tg on public.live_status;
create trigger office_price_follow_tg after update of office_price_cents on public.live_status
  for each row execute function public.office_program_follow();
drop trigger if exists office_market_window_follow_tg on public.markets;
create trigger office_market_window_follow_tg after update of office_window on public.markets
  for each row execute function public.office_program_follow();

-- ── 9 · the helpers are the database's, not the app's ────────────────────────────────────────────
revoke all on function public.office_tz(text) from public, anon;
revoke all on function public.office_local_today(text) from public, anon;
revoke all on function public.office_cutoff(date, text) from public, anon;
revoke all on function public.office_rule_matches(public.company_programs, date) from public, anon;
revoke all on function public.office_closure(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.office_window(public.company_programs) from public, anon;
revoke all on function public.office_price(public.company_programs) from public, anon;
revoke all on function public.office_make_delivery(public.company_programs, date) from public, anon, authenticated;
revoke all on function public.office_generate(uuid, text, date, uuid, date) from public, anon, authenticated;
revoke all on function public.company_program_active_since() from public, anon, authenticated;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Office deliveries make themselves, once each','improvement','Delivery',
   'Weekly office deliveries now come from each client''s program on its own schedule: every night after 3 AM each city''s time, the next week''s deliveries are made, never twice, and the crew''s Generate button does the same on demand. Each delivery knows when changes close — 6 PM the weekday before, in its city''s time — and a delivery nobody has touched follows the program until then: a pause takes it off, a resume brings it back, new gallons change it. Atlanta''s 6–9 AM window finally applies. Closed dates skip or move deliveries, and a failed run raises an alert instead of passing quietly.',
   '2026-10-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select count(*) from pg_indexes where indexname = 'business_orders_program_date';                     -- 1
--   select public.office_cutoff('2026-11-02', 'greenville');      -- 2026-10-30 22:00:00+00 (Fri 6 PM EDT; the clocks change on Nov 1)
--   select public.office_cutoff('2026-11-09', 'greenville');      -- 2026-11-06 23:00:00+00 (Fri 6 PM EST)
--   select * from public.office_next_delivery('greenville');      -- the next Monday whose Friday 6 PM is ahead
--   select jobname, schedule from cron.job where jobname = 'office-generation';                            -- 7 * * * *
select public.record_migration('0356_the_weekly_run_comes_from_the_program',
  'company_programs rule (every_n_weeks, weekdays, anchor_date, monthly_nth, delivery_window, starts_on, ends_on, price_per_gallon_cents, active_since); business_orders scheduled_for, cutoff_at, canceled_reason + unique (program_id, scheduled_for); office_closed_dates; job_runs; office_* rule/clock/place/price helpers; office_make_delivery, office_generate, run_office_generation (cron office-generation, hourly), generate_office_deliveries, generate_office_route (wrapper), book_office_standing, office_next_delivery; office_untouched + office_program_follow (programs: status, rule, window, price; lines; locations; Settings price; market window).');
