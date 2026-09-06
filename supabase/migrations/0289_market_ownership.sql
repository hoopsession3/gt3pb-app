-- 0289 — AN OPERATOR CAN RUN A MARKET. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- The question was: can an operator own a market — manage the staff under him, and be eligible for
-- equity. The honest answer today is no, and not for a small reason.
--
--   * ROLES ARE COMPANY-WIDE. is_staff() and is_admin() ask what your role IS, never where. An
--     operator in Atlanta reads Greenville's customers, Greenville's margins and Greenville's
--     expenses, because there is no "where" to check.
--   * NOBODY BUT AN OWNER CAN ASSIGN A ROLE. admin_set_role is owner-only. An operator cannot make
--     someone a server, cannot take the role back when they leave, cannot do the one thing that
--     "manages the staff under him" actually means.
--   * THE ONLY WAY TO GIVE HIM THAT TODAY IS TO MAKE HIM AN OWNER — which hands him both cities,
--     the shop, the offer letters, the ability to make more owners, and a vote on his own deal.
--
-- So this file adds the missing dimension: WHERE. A profile belongs to a market, and one profile per
-- market can LEAD it. A market lead can assign roles — inside their own market, to a bounded set of
-- roles, never to themselves, never reaching an admin, an operator or an owner. That is real
-- authority over their own crew and no reach at all into the company or the other city.
--
-- ON EQUITY, DELIBERATELY LESS. The agreement gains an eligibility flag and a scope, and nothing
-- else. It does NOT record a percentage, a class, a vesting schedule or a holder — because a row in
-- an app database is not a cap table, and a number here that disagrees with the operating agreement
-- is worse than no number. What it does record is the thing that actually needs recording: that this
-- tier is eligible, and WHICH entity the equity would be in — the company, or a separate entity for
-- that market. Those are different deals with different consequences, and 'undecided' is the default
-- because it is true.
--
-- ZERO REGRESSION: profiles.market defaults to the founding market so every existing person is
-- exactly where they already were; leads_market is null for everyone, so no new authority exists
-- until an owner grants it. is_staff() and is_admin() are NOT touched — this file adds a scope, it
-- does not narrow any existing gate. Narrowing what an operator can READ is a separate decision with
-- a blast radius, and it belongs in its own migration after someone looks at every policy.
--
-- Apply after 0288.

-- ── 1. A person belongs to a market, and may lead one ────────────────────────────────────────────
alter table public.profiles add column if not exists market text not null default 'greenville';
alter table public.profiles add column if not exists leads_market text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_market_fk') then
    alter table public.profiles add constraint profiles_market_fk
      foreign key (market) references public.markets(slug);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_leads_market_fk') then
    alter table public.profiles add constraint profiles_leads_market_fk
      foreign key (leads_market) references public.markets(slug);
  end if;
end $$;
create index if not exists profiles_market_idx on public.profiles(market);

comment on column public.profiles.market is
  'Which city this person works in. Owners are in the founding market by convention and are not limited by it.';
comment on column public.profiles.leads_market is
  'The market this person LEADS. Null for almost everyone. Set only by an owner, and it is the only thing that lets a non-owner assign a role.';

-- One lead per market. Two people who can both hire and fire the same crew is not a structure.
create unique index if not exists profiles_one_lead_per_market
  on public.profiles(leads_market) where leads_market is not null;

-- ── 2. Who leads what ────────────────────────────────────────────────────────────────────────────
create or replace function public.leads_market() returns text
  language sql stable security definer set search_path = public as $$
  select leads_market from public.profiles where id = auth.uid()
$$;
grant execute on function public.leads_market() to authenticated;

create or replace function public.is_market_lead(p_market text default null) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and leads_market is not null
       and (p_market is null or leads_market = p_market)
  )
$$;
grant execute on function public.is_market_lead(text) to authenticated;

-- Only an owner hands out a market. Assigning the lead is not itself a role change, so it goes
-- through its own function rather than widening admin_set_role.
create or replace function public.set_market_lead(p_member uuid, p_market text)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not public.is_owner() then raise exception 'Only an owner can put someone in charge of a market.'; end if;
  if p_market is not null and not exists (select 1 from public.markets where slug = p_market) then
    raise exception 'No such market: %', p_market;
  end if;

  select role into r from public.profiles where id = p_member;
  if r is null then raise exception 'no such profile'; end if;
  if p_market is not null and r not in ('operator','event_manager','admin','owner') then
    raise exception 'A market lead has to be an operator, event manager, admin or owner first. This person is a %.', r;
  end if;

  -- Clear anyone else holding this market, so the unique index is never the thing that reports it.
  if p_market is not null then
    update public.profiles set leads_market = null
     where leads_market = p_market and id is distinct from p_member;
  end if;

  update public.profiles set leads_market = p_market, market = coalesce(p_market, market)
   where id = p_member;
end $$;
revoke all on function public.set_market_lead(uuid, text) from public;
grant execute on function public.set_market_lead(uuid, text) to authenticated;

-- ── 3. A market lead can staff their own market ──────────────────────────────────────────────────
-- Rewritten from 0280's live body. Everything 0280 established is preserved exactly: the valid-role
-- list, the last-owner guard, and is_admin written as a MIRROR of role in the same statement. What
-- is added is a second, narrower caller.
--
-- The bounds on that caller are the whole security argument, so they are stated once, here:
--   · only profiles whose market equals the market they lead
--   · only to and from member / server / contractor / event_manager
--     (never admin, never owner, never operator — those are company decisions)
--   · never themselves, in either direction
--   · and they cannot move someone INTO their market, only change a role within it
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  cur    text;
  owners int;
  tgt_mk text;
  lead   text;
  LEADABLE constant text[] := array['member','server','contractor','event_manager'];
begin
  -- Authorisation FIRST, before anything is looked up. Checking the caller after fetching the
  -- target would let anyone with a login distinguish 'no such profile' from 'owner only' and so
  -- confirm whether a given id exists. Small, but it costs nothing to close.
  lead := public.leads_market();
  if not public.is_owner() and lead is null then raise exception 'owner only'; end if;

  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;

  select role, market into cur, tgt_mk from public.profiles where id = member;
  if cur is null then raise exception 'no such profile'; end if;

  if not public.is_owner() then
    if member = auth.uid() then
      raise exception 'You cannot change your own role. Ask an owner.';
    end if;
    if tgt_mk is distinct from lead then
      raise exception 'That person is not in %. A market lead can only set roles inside their own market.', lead;
    end if;
    if not (cur = any(LEADABLE)) then
      raise exception 'A market lead cannot change a %. That is an owner decision.', cur;
    end if;
    if not (new_role = any(LEADABLE)) then
      raise exception 'A market lead can set member, server, contractor or event manager. % is an owner decision.', new_role;
    end if;
  end if;

  -- Finding 2 from 0280: refuse to remove the last owner. Unreachable from the lead path above,
  -- kept because the owner path still runs through here.
  if cur = 'owner' and new_role <> 'owner' then
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'This is the last owner. Promote someone else to owner first, then change this role.';
    end if;
  end if;

  -- Finding 1 from 0280: is_admin is a MIRROR of role, never an independent grant.
  update public.profiles
     set role = new_role,
         is_admin = (new_role in ('admin','owner'))
   where id = member;
end $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- Losing your market takes your lead with it. Without this, moving someone to Atlanta would leave
-- them holding Greenville's crew.
create or replace function public.sync_leads_market() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.market is distinct from old.market
     and new.leads_market is not null
     and new.leads_market is not distinct from old.leads_market
     and new.leads_market <> new.market then
    new.leads_market := null;
  end if;
  return new;
end $$;

drop trigger if exists zz_sync_leads_market on public.profiles;
create trigger zz_sync_leads_market before update of market on public.profiles
  for each row execute function public.sync_leads_market();

-- ── 4. Who is in my market ───────────────────────────────────────────────────────────────────────
create or replace view public.v_market_crew as
select p.id, p.display_name, p.role, p.market, p.leads_market,
       (p.leads_market is not null) as leads_this_market,
       p.role in ('member','server','contractor','event_manager') as lead_can_set_role
  from public.profiles p
 where p.role <> 'member' or p.leads_market is not null;

revoke all on public.v_market_crew from public, anon;
grant select on public.v_market_crew to authenticated;

comment on view public.v_market_crew is
  'The crew, with the market each person belongs to and whether a market lead is allowed to change their role. Read gating is the existing staff policy on profiles; this view adds no reach.';

-- ── 5. Equity: eligibility and scope, and nothing that pretends to be a cap table ────────────────
alter table public.operator_agreements add column if not exists equity_eligible boolean not null default false;
alter table public.operator_agreements add column if not exists equity_scope text not null default 'undecided'
  check (equity_scope in ('undecided','none','company','market_entity'));
alter table public.operator_agreements add column if not exists equity_note text;

comment on column public.operator_agreements.equity_eligible is
  'Whether this tier is ELIGIBLE to be offered equity. Not a holding, not a grant, not a promise — eligibility only. The instrument itself lives with counsel.';
comment on column public.operator_agreements.equity_scope is
  'company = a piece of GT3 itself. market_entity = a piece of a separate entity that owns that city. Different deals with different consequences; undecided until someone chooses.';
comment on column public.operator_agreements.equity_note is
  'Where the actual paper lives, and who drafted it. Deliberately free text — this column is a pointer, not a record.';

-- Eligibility and scope are terms. They freeze on acceptance with everything else.
create or replace function public.guard_agreement_terms() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.status not in ('accepted','active','ended') then return new; end if;
  if current_setting('gt3.allow_hard_delete', true) = 'on' then return new; end if;

  if new.operator_pct   is distinct from old.operator_pct
  or new.royalty_pct    is distinct from old.royalty_pct
  or new.market_pct     is distinct from old.market_pct
  or new.supply_funding is distinct from old.supply_funding
  or new.tier           is distinct from old.tier
  or new.stage          is distinct from old.stage
  or new.package        is distinct from old.package
  or new.market         is distinct from old.market
  or new.supply_sourcing    is distinct from old.supply_sourcing
  or new.supply_price_basis is distinct from old.supply_price_basis
  or new.supply_markup_pct  is distinct from old.supply_markup_pct
  or new.spec_items         is distinct from old.spec_items
  or new.equity_eligible    is distinct from old.equity_eligible
  or new.equity_scope       is distinct from old.equity_scope then
    raise exception 'This agreement was already accepted — its terms are final. End it and draft a new version instead. (Deliberate correction: select set_config(''gt3.allow_hard_delete'',''on'',false); first.)';
  end if;
  return new;
end $$;

drop trigger if exists guard_terms_operator_agreements on public.operator_agreements;
create trigger guard_terms_operator_agreements before update on public.operator_agreements
  for each row execute function public.guard_agreement_terms();

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Someone can run a city without running the company','improvement','Crew',
   'Until now the only way to let someone manage a crew was to make them an owner, which handed them both cities, the shop, the offer letters and the ability to make more owners. A person now belongs to a city, and one person per city can lead it. A market lead can set roles for their own crew — member, server, contractor, event manager — and cannot touch anyone in the other city, cannot create an admin or an owner, and cannot change their own role. Operator agreements can also record that a tier is eligible for equity and whether that would be in the company or in a separate entity for that city; the actual paperwork stays with a lawyer, where it belongs.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- everyone landed in the founding market and nobody leads anything yet:
--   select market, count(*), count(leads_market) as leads from public.profiles group by 1;
--
--   -- the crew, by city:
--   select display_name, role, market, leads_this_market, lead_can_set_role from public.v_market_crew;
--
--   -- put the Atlanta lead in charge once they exist (owner only):
--   -- select public.set_market_lead('<their uuid>', 'atlanta');
--
--   -- and a market lead reaching into the other city: expect EXCEPTION
--   -- select public.admin_set_role('<a greenville profile>', 'server');
