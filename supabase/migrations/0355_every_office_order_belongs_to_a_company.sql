-- 0355 — EVERY OFFICE ORDER BELONGS TO A COMPANY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Phase 1, part 1 of the B2B challenge report (2026-10-07, "GT3 Challenge Report — B2B and Adaptive
-- Layout", the Migration and Proposed model sections). The office feature has one record for
-- everything — business_accounts is the company, its one address, its one person and its weekly
-- order at once — and a one-off order belongs to no record at all. This lays the records the rest of
-- the plan stands on, and changes nothing anyone sees:
--
--   companies              who GT3 sells to and serves (a venue or supplier stays a vendor)
--   company_locations      each site: address, door notes, window, market, site contact
--   company_members        the people who sign in for a company, with a role
--   company_programs       the standing agreement at one location (the weekly order, today)
--   company_program_lines  what a program brings: product × quantity × unit (one line today)
--
-- and nullable company / location / program links on business_accounts, business_orders, invoices,
-- jug_ledger and opportunities. "Program" is spelled company_program on purpose: program_access
-- (0271) already means the Academy's programs.
--
-- HOW IT STAYS TRUE. Nothing writes the new tables but this file's triggers, for now. The office
-- account stays the record the screens and the booking route write; a trigger on it keeps its
-- company, location, person and program in step (one way, account → company). A trigger on each
-- new order, invoice and jug-ledger row gives it its company and location; a one-off order with no
-- account joins the same person's company of the same name, at the same address, or starts one.
-- Each screen moves to the new records in its own phase; only then does the account stop being
-- the writer. Clients and staff READ the new tables (clients only their own company); no one but
-- these triggers writes them, so there is never a second place to edit and get out of step.
--
-- WHAT IT DOES NOT DO. It adds; it does not change a value anyone reads. No column of the old tables
-- changes but the new links. Amounts, statuses, invoices, jug counts and the weekly run are exactly
-- as they were (the weekly run moves to programs in the next part, 0356). Undo is dropping the new
-- tables and links. Accounts are never merged: two accounts are two companies, whatever they are
-- called, until a person says otherwise.
--
-- THE BACKFILL, PROVED (scripts/db.spine.test.mjs, against every migration): accounts in = companies
-- from accounts out; every office order, invoice and jug entry has a company; order totals, invoice
-- amounts and jug balances are the same sums before and after; running the file twice adds nothing.
--
-- changelog: below.

-- ── 1 · the records ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  name          text not null check (btrim(name) <> ''),
  -- prospect → onboarding → live → paused → ended. From an office account: paused while its weekly
  -- order is paused, live otherwise (an account exists because someone booked).
  status        text not null default 'live' check (status in ('prospect', 'onboarding', 'live', 'paused', 'ended')),
  market        text not null default 'greenville',   -- home market; each location carries its own
  billing_terms text not null default 'prepaid' check (billing_terms in ('prepaid', 'net15', 'net30')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.company_locations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id          uuid not null references public.companies(id),
  label               text,                            -- "Greenville HQ"; null reads as the street
  address_street      text,
  address_city        text,
  address_zip         text,
  access_instructions text,
  -- null = the market's office window. An account's window is carried only when someone set one:
  -- business_accounts.preferred_window is NOT NULL DEFAULT 'mon_0500_0800', so the default there
  -- says nothing and the market's own window never won (the report's defect 4).
  delivery_window     text,
  market              text not null default 'greenville',
  contact_name        text,
  contact_phone       text,
  contact_email       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists company_locations_company on public.company_locations (company_id);

create table if not exists public.company_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid not null references public.companies(id),
  -- nullable: deleting a person's GT3 account (0353) lets go of them here and keeps the record that
  -- the company had someone in this role
  user_id     uuid references auth.users(id) on delete set null,
  role        text not null default 'admin' check (role in ('admin', 'billing', 'location_manager', 'orderer', 'viewer')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists company_members_person on public.company_members (company_id, user_id) where user_id is not null;
create index if not exists company_members_user on public.company_members (user_id) where user_id is not null;

create table if not exists public.company_programs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid not null references public.companies(id),
  location_id uuid not null references public.company_locations(id),
  service     text not null default 'office_cold_brew' check (service in ('office_cold_brew')),
  status      text not null default 'active' check (status in ('active', 'paused', 'ended')),
  market      text not null default 'greenville',   -- the location's, so the crew's city filter reaches it
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists company_programs_company on public.company_programs (company_id);
create index if not exists company_programs_location on public.company_programs (location_id);

create table if not exists public.company_program_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  program_id  uuid not null references public.company_programs(id),
  product     text not null default 'cold_brew_gallon' check (product in ('cold_brew_gallon')),
  quantity    numeric not null check (quantity > 0),
  unit        text not null default 'gallon' check (unit in ('gallon')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (program_id, product)
);

-- ── 2 · the links (nullable: every old row keeps working while it has none) ───────────────────────
alter table public.business_accounts add column if not exists company_id uuid references public.companies(id);
alter table public.business_accounts add column if not exists location_id uuid references public.company_locations(id);
alter table public.business_accounts add column if not exists program_id uuid references public.company_programs(id);
alter table public.business_orders add column if not exists company_id uuid references public.companies(id);
alter table public.business_orders add column if not exists location_id uuid references public.company_locations(id);
alter table public.business_orders add column if not exists program_id uuid references public.company_programs(id);
alter table public.invoices add column if not exists company_id uuid references public.companies(id);
alter table public.invoices add column if not exists location_id uuid references public.company_locations(id);
alter table public.jug_ledger add column if not exists company_id uuid references public.companies(id);
alter table public.jug_ledger add column if not exists location_id uuid references public.company_locations(id);
alter table public.opportunities add column if not exists company_id uuid references public.companies(id);

create index if not exists business_accounts_company on public.business_accounts (company_id);
create index if not exists business_orders_company on public.business_orders (company_id, delivery_date);
create index if not exists business_orders_location on public.business_orders (location_id, delivery_date);
create index if not exists invoices_company on public.invoices (company_id);
create index if not exists jug_ledger_location on public.jug_ledger (location_id);
create index if not exists opportunities_company on public.opportunities (company_id) where company_id is not null;

-- ── 3 · the office account keeps its company in step (account → company, one way) ─────────────────
-- Runs before every insert and update of an account, after office_account_lost_person (0354) by
-- name, so an account that has just lost its person arrives here with its weekly order already off.
-- Touches a company row only when one of its values actually changes.
create or replace function public.office_account_spine() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := new.company_id;
  v_location uuid := new.location_id;
  v_program  uuid := new.program_id;
  v_status   text := case when new.standing_gallons is not null and not new.standing_active then 'paused' else 'live' end;
  v_window   text := nullif(new.preferred_window, 'mon_0500_0800');
  -- never a reason to refuse a booking: an account's name has no rule of its own
  v_name     text := coalesce(nullif(btrim(new.company), ''), '(no name)');
begin
  if v_company is null then
    insert into public.companies (tenant_id, name, status, market, billing_terms)
    values (new.tenant_id, v_name, v_status, new.market, new.billing_terms)
    returning id into v_company;
  else
    update public.companies
       set name = v_name, status = v_status, market = new.market, billing_terms = new.billing_terms, updated_at = now()
     where id = v_company
       and (name, status, market, billing_terms) is distinct from (v_name, v_status, new.market, new.billing_terms);
  end if;

  if v_location is null then
    insert into public.company_locations (tenant_id, company_id, address_street, address_city, address_zip,
                                          access_instructions, delivery_window, market, contact_name, contact_phone, contact_email)
    values (new.tenant_id, v_company, new.address_street, new.address_city, new.address_zip,
            new.access_instructions, v_window, new.market, new.contact_name, new.contact_phone, new.contact_email)
    returning id into v_location;
  else
    update public.company_locations
       set address_street = new.address_street, address_city = new.address_city, address_zip = new.address_zip,
           access_instructions = new.access_instructions, delivery_window = v_window, market = new.market,
           contact_name = new.contact_name, contact_phone = new.contact_phone, contact_email = new.contact_email,
           updated_at = now()
     where id = v_location
       and (address_street, address_city, address_zip, access_instructions, delivery_window, market,
            contact_name, contact_phone, contact_email)
           is distinct from
           (new.address_street, new.address_city, new.address_zip, new.access_instructions, v_window, new.market,
            new.contact_name, new.contact_phone, new.contact_email);
  end if;

  -- the person who booked is the company's admin; a person who leaves the account leaves the role
  if new.user_id is not null and (tg_op = 'INSERT' or new.company_id is null or old.user_id is distinct from new.user_id) then
    insert into public.company_members (tenant_id, company_id, user_id, role, active)
    values (new.tenant_id, v_company, new.user_id, 'admin', true)
    on conflict (company_id, user_id) where user_id is not null
    do update set active = true, updated_at = now() where company_members.active is distinct from true;
  end if;
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
    update public.company_members set active = false, updated_at = now()
     where company_id = v_company and user_id = old.user_id and active;
  end if;

  -- the weekly order is the company's program at this location
  if new.standing_gallons is not null then
    -- a weekly order that ended and started again is a new agreement, not the old one revived
    if v_program is not null and exists (select 1 from public.company_programs where id = v_program and status = 'ended') then
      v_program := null;
    end if;
    if v_program is null then
      insert into public.company_programs (tenant_id, company_id, location_id, service, status, market)
      values (new.tenant_id, v_company, v_location, 'office_cold_brew',
              case when new.standing_active then 'active' else 'paused' end, new.market)
      returning id into v_program;
      insert into public.company_program_lines (tenant_id, program_id, product, quantity, unit)
      values (new.tenant_id, v_program, 'cold_brew_gallon', new.standing_gallons, 'gallon');
    else
      update public.company_programs
         set status = case when new.standing_active then 'active' else 'paused' end,
             location_id = v_location, market = new.market, updated_at = now()
       where id = v_program and status <> 'ended'
         and (status, location_id, market)
             is distinct from (case when new.standing_active then 'active' else 'paused' end, v_location, new.market);
      update public.company_program_lines set quantity = new.standing_gallons, updated_at = now()
       where program_id = v_program and product = 'cold_brew_gallon' and quantity is distinct from new.standing_gallons;
    end if;
  elsif v_program is not null then
    update public.company_programs set status = 'ended', updated_at = now()
     where id = v_program and status <> 'ended';
  end if;

  new.company_id  := v_company;
  new.location_id := v_location;
  new.program_id  := v_program;
  return new;
end $$;
revoke all on function public.office_account_spine() from public, anon, authenticated;

drop trigger if exists office_account_spine_tg on public.business_accounts;
create trigger office_account_spine_tg
  before insert or update on public.business_accounts
  for each row execute function public.office_account_spine();

-- ── 4 · every office order has a company and a location ─────────────────────────────────────────
-- From its account when it has one. A one-off order has none (the booking route files it that way):
-- it joins the company its person already has under that name — through their account, or through
-- an earlier one-off — at the location with the same street and ZIP, or a new location there; and
-- failing all of that, it starts a company of its own from what the order says.
create or replace function public.office_order_spine() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a        record;
  v_name   text := lower(btrim(new.company));
  v_street text := lower(btrim(coalesce(new.address_street, '')));
  v_zip    text := btrim(coalesce(new.address_zip, ''));
begin
  if new.business_id is not null then
    select company_id, location_id, program_id into a from public.business_accounts where id = new.business_id;
    new.company_id  := coalesce(new.company_id, a.company_id);
    new.location_id := coalesce(new.location_id, a.location_id);
    if new.standing then new.program_id := coalesce(new.program_id, a.program_id); end if;
    return new;
  end if;
  if new.company_id is not null and new.location_id is not null then return new; end if;

  if new.company_id is null and new.user_id is not null then
    select ba.company_id into new.company_id
      from public.business_accounts ba
     where ba.user_id = new.user_id and lower(btrim(ba.company)) = v_name and ba.company_id is not null
     order by ba.created_at
     limit 1;
  end if;
  if new.company_id is null then
    select bo.company_id into new.company_id
      from public.business_orders bo
     where bo.business_id is null and bo.company_id is not null and bo.tenant_id = new.tenant_id
       and bo.user_id is not distinct from new.user_id and lower(btrim(bo.company)) = v_name
     order by bo.created_at
     limit 1;
  end if;

  if new.company_id is null then
    insert into public.companies (tenant_id, name, status, market, billing_terms)
    values (new.tenant_id, coalesce(nullif(btrim(new.company), ''), '(no name)'), 'live', new.market, new.billing_terms)
    returning id into new.company_id;
  end if;

  if new.location_id is null then
    select l.id into new.location_id
      from public.company_locations l
     where l.company_id = new.company_id
       and lower(btrim(coalesce(l.address_street, ''))) = v_street and btrim(coalesce(l.address_zip, '')) = v_zip
     order by l.created_at
     limit 1;
  end if;
  if new.location_id is null then
    insert into public.company_locations (tenant_id, company_id, address_street, address_city, address_zip,
                                          access_instructions, market, contact_name, contact_phone)
    values (new.tenant_id, new.company_id, new.address_street, new.address_city, new.address_zip,
            new.access_instructions, new.market, new.contact_name, new.contact_phone)
    returning id into new.location_id;
  end if;
  return new;
end $$;
revoke all on function public.office_order_spine() from public, anon, authenticated;

drop trigger if exists office_order_spine_tg on public.business_orders;
create trigger office_order_spine_tg
  before insert or update of business_id, company_id, location_id on public.business_orders
  for each row execute function public.office_order_spine();

-- ── 5 · an invoice and a jug entry take their company from the order (or the account) ───────────
create or replace function public.office_money_spine() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a record;
begin
  if new.company_id is not null and new.location_id is not null then return new; end if;
  if new.business_order_id is not null then
    select company_id, location_id into a from public.business_orders where id = new.business_order_id;
    new.company_id  := coalesce(new.company_id, a.company_id);
    new.location_id := coalesce(new.location_id, a.location_id);
  end if;
  if (new.company_id is null or new.location_id is null) and new.business_id is not null then
    select company_id, location_id into a from public.business_accounts where id = new.business_id;
    new.company_id  := coalesce(new.company_id, a.company_id);
    new.location_id := coalesce(new.location_id, a.location_id);
  end if;
  return new;
end $$;
revoke all on function public.office_money_spine() from public, anon, authenticated;

drop trigger if exists office_invoice_spine_tg on public.invoices;
create trigger office_invoice_spine_tg
  before insert or update of business_id, business_order_id, company_id, location_id on public.invoices
  for each row execute function public.office_money_spine();
drop trigger if exists office_jug_spine_tg on public.jug_ledger;
create trigger office_jug_spine_tg
  before insert or update of business_id, business_order_id, company_id, location_id on public.jug_ledger
  for each row execute function public.office_money_spine();

-- A deal wired to an office account (0268) belongs to that account's company.
create or replace function public.opportunity_company_spine() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null and new.business_account_id is not null then
    select company_id into new.company_id from public.business_accounts where id = new.business_account_id;
  end if;
  return new;
end $$;
revoke all on function public.opportunity_company_spine() from public, anon, authenticated;

drop trigger if exists opportunity_company_spine_tg on public.opportunities;
create trigger opportunity_company_spine_tg
  before insert or update of business_account_id, company_id on public.opportunities
  for each row execute function public.opportunity_company_spine();

-- ── 6 · who reads the new records, and that nobody writes them but the triggers above ────────────
alter table public.companies enable row level security;
alter table public.company_locations enable row level security;
alter table public.company_members enable row level security;
alter table public.company_programs enable row level security;
alter table public.company_program_lines enable row level security;

-- Is the caller an active member of this company? (definer: the membership read does not depend on
-- the caller's own policies, and a client can only ever ask about themselves)
create or replace function public.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_company and m.user_id = (select auth.uid()) and m.active
  )
$$;
revoke all on function public.is_company_member(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;

drop policy if exists "companies staff read" on public.companies;
create policy "companies staff read" on public.companies for select using ((select public.is_staff()));
drop policy if exists "companies member read" on public.companies;
create policy "companies member read" on public.companies for select using (public.is_company_member(id));

drop policy if exists "company locations staff read" on public.company_locations;
create policy "company locations staff read" on public.company_locations for select using ((select public.is_staff()));
drop policy if exists "company locations member read" on public.company_locations;
create policy "company locations member read" on public.company_locations for select using (public.is_company_member(company_id));

drop policy if exists "company members staff read" on public.company_members;
create policy "company members staff read" on public.company_members for select using ((select public.is_staff()));
drop policy if exists "company members own read" on public.company_members;
create policy "company members own read" on public.company_members for select using (user_id = (select auth.uid()));

drop policy if exists "company programs staff read" on public.company_programs;
create policy "company programs staff read" on public.company_programs for select using ((select public.is_staff()));
drop policy if exists "company programs member read" on public.company_programs;
create policy "company programs member read" on public.company_programs for select using (public.is_company_member(company_id));

drop policy if exists "company program lines staff read" on public.company_program_lines;
create policy "company program lines staff read" on public.company_program_lines for select using ((select public.is_staff()));
drop policy if exists "company program lines member read" on public.company_program_lines;
create policy "company program lines member read" on public.company_program_lines for select
  using (exists (select 1 from public.company_programs p where p.id = program_id and public.is_company_member(p.company_id)));

do $$
declare t text;
begin
  foreach t in array array['companies', 'company_locations', 'company_members', 'company_programs', 'company_program_lines'] loop
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', t);
    -- The grants say what the policies say: read for the signed-in, nothing for anyone else, and no
    -- writes from the app at all while the office account is the record the screens write.
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- The crew's city filter (0291), on the records that carry a city.
  foreach t in array array['companies', 'company_locations', 'company_programs'] loop
    execute format('drop policy if exists "market scope" on public.%I', t);
    execute format('create policy "market scope" on public.%I as restrictive for select using (public.market_visible(market))', t);
  end loop;
  -- A company, a site and an agreement are records orders and invoices point at: never hard-deleted
  -- (0308's guard; deliberate maintenance only).
  foreach t in array array['companies', 'company_locations', 'company_programs'] loop
    execute format('drop trigger if exists guard_delete_%1$s on public.%1$I', t);
    execute format('create trigger guard_delete_%1$s before delete on public.%1$I for each row execute function public.guard_permanent_record()', t);
    execute format('drop policy if exists %1$I_delete_admin_only on public.%1$I', t);
    execute format('create policy %1$I_delete_admin_only on public.%1$I as restrictive for delete using (public.is_admin())', t);
  end loop;
end $$;

comment on table public.companies is
  'Who GT3 sells to and serves (0355). A venue, supplier or host stays a vendor. Written only by office_account_spine / office_order_spine while the office account is the record the screens write.';
comment on table public.company_locations is
  'A company''s site: address, door notes, delivery window (null = the market''s), market, site contact (0355).';
comment on table public.company_members is
  'The people who sign in for a company, with a role (0355). From an office account: its person, as admin.';
comment on table public.company_programs is
  'The standing agreement at one location (0355). From an office account: its weekly order, active or paused.';
comment on table public.company_program_lines is
  'What a program brings, as product × quantity × unit (0355). One line today: cold brew by the gallon.';

-- ── 7 · the backfill: the same triggers, row by row, oldest first ────────────────────────────────
-- Each statement names its rows (the ones without a company yet), so a second paste finds none.
do $$
declare r record; n_acct int := 0; n_ord int := 0;
begin
  for r in select id from public.business_accounts where company_id is null order by created_at, id loop
    update public.business_accounts set company_id = null where id = r.id;   -- fires office_account_spine
    n_acct := n_acct + 1;
  end loop;
  for r in select id from public.business_orders where company_id is null order by created_at, id loop
    update public.business_orders set company_id = null where id = r.id;     -- fires office_order_spine
    n_ord := n_ord + 1;
  end loop;
  update public.invoices set company_id = null where company_id is null;      -- fires office_money_spine
  update public.jug_ledger set company_id = null where company_id is null;    -- fires office_money_spine
  update public.opportunities set company_id = null where company_id is null and business_account_id is not null;
  if n_acct + n_ord > 0 then
    raise notice '0355: % office account(s) and % office order(s) linked to their companies', n_acct, n_ord;
  end if;
end $$;

-- ── what changed ───────────────────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Every office order belongs to a company','improvement','Delivery',
   'Office clients now have the records a growing account needs: the company, each of its locations, the people who sign in for it, and its weekly program. Every office order, invoice and jug count belongs to a company and a location, including one-off orders that used to belong to no one. Nothing on any screen changes yet; this is the foundation the scheduled weekly run, the client''s calendar and the account manager''s book are built on.',
   '2026-10-07', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select (select count(*) from public.business_accounts) = (select count(distinct company_id) from public.business_accounts);   -- t
--   select count(*) from public.business_orders where company_id is null or location_id is null;                         -- 0
--   select count(*) from public.invoices where company_id is null and (business_id is not null or business_order_id is not null);   -- 0
--   select count(*) from public.jug_ledger where company_id is null;                                                       -- 0
--   select count(*) from public.business_accounts a left join public.company_programs p on p.id = a.program_id
--    where (a.standing_gallons is not null) <> (p.id is not null);                                                        -- 0
select public.record_migration('0355_every_office_order_belongs_to_a_company',
  'companies, company_locations, company_members, company_programs, company_program_lines; company/location/program links on business_accounts, business_orders, invoices, jug_ledger, opportunities; office_account_spine (account → company, one way), office_order_spine, office_money_spine, opportunity_company_spine; member/staff read, tenant isolation, market scope, delete guards; backfill.');
