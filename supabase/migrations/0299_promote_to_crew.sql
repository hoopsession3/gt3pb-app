-- 0299 — Bringing a customer into the business.
--
-- WHY THERE WAS NOWHERE TO CLICK. The owner went looking for how to make Niño the Atlanta city
-- operator and could not find it, because it does not exist. Niño is already in profiles — 14 of the
-- 15 customers are — and he already has an auth account. He simply holds role 'member', and the crew
-- roster does this:
--
--   const staff = members.filter((m) => rawRole(m) !== "member");
--
-- Every profile is fetched and everyone at 'member' is then filtered out and reduced to a count in a
-- banner. The role picker only renders on rows that survive that filter, so the member → crew line is
-- the one transition the app has no control for. Someone can be promoted from server to operator all
-- day; nobody can be brought in from the customer list at all.
--
-- WHY THIS IS ONE FUNCTION AND NOT THREE CALLS. Making somebody a city operator is three writes:
-- the role, the market they belong to, and the market they lead. They have a required ORDER —
-- set_market_lead refuses anyone who is not already an operator or above — and two of the three have
-- no client path at all: profiles has carried exactly one update policy since 0001,
--
--   create policy "own profile update" on public.profiles for update using (auth.uid() = id);
--
-- so an owner cannot write another person's market from the browser however the UI is built. Three
-- round-trips could also strand someone half-promoted: role changed, market not, and now they read
-- another city's money through 0291's scoping. One transaction, or nothing.
--
-- WHY 'owner' AND 'member' ARE NOT PROMOTION TARGETS. This is the hire door, not the whole role
-- ladder. 'member' is where they already are, and making another owner is a deliberate act with its
-- own confirmations on the roster — 0281 made the same call for offer letters, which likewise refuse
-- to grant 'owner' as a line item. Demotion stays where it already lives.

create or replace function public.set_member_market(p_member uuid, p_market text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() and public.leads_market() is distinct from p_market then
    raise exception 'Only an owner, or the lead of that market, can move someone into it.';
  end if;
  if p_market is null or not exists (select 1 from public.markets where slug = p_market) then
    raise exception 'No such market: %', coalesce(p_market, '(null)');
  end if;
  if not exists (select 1 from public.profiles where id = p_member) then
    raise exception 'no such profile';
  end if;
  update public.profiles set market = p_market where id = p_member;
end $$;
revoke all on function public.set_member_market(uuid, text) from public;
grant execute on function public.set_member_market(uuid, text) to authenticated;

comment on function public.set_member_market(uuid, text) is
  'Moves a person into a market. profiles has only ever had an own-profile update policy, so this is the only way one person can set another''s market.';

-- ── the hire door ──────────────────────────────────────────────────────────────────────────────
create or replace function public.promote_to_crew(
  p_member uuid, p_role text, p_market text default null, p_lead boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur text; nm text; mk text;
begin
  select role, display_name, market into cur, nm, mk from public.profiles where id = p_member;
  if cur is null then raise exception 'no such profile'; end if;

  if p_role in ('owner', 'member') then
    raise exception 'This brings someone into the crew. Making an owner, or moving someone back to a customer, is done from the team roster.';
  end if;
  if cur <> 'member' then
    raise exception '% is already on the crew as a %. Change the role from the team roster instead.',
      coalesce(nm, 'This person'), cur;
  end if;

  -- The role first: set_market_lead refuses anyone who is not already an operator or above, and
  -- admin_set_role carries the authorisation rules for who may grant what. Not re-implemented here.
  perform public.admin_set_role(p_member, p_role);

  if p_market is not null then
    perform public.set_member_market(p_member, p_market);
    mk := p_market;
  end if;

  -- Leading a market is owner-only and lives in set_market_lead; letting it raise is the point.
  if p_lead then
    if p_market is null then
      raise exception 'Say which market they lead.';
    end if;
    perform public.set_market_lead(p_member, p_market);
  end if;

  return jsonb_build_object(
    'member', p_member, 'name', nm, 'from', cur, 'role', p_role,
    'market', mk, 'leads', p_lead);
end $$;
revoke all on function public.promote_to_crew(uuid, text, text, boolean) from public;
grant execute on function public.promote_to_crew(uuid, text, text, boolean) to authenticated;

comment on function public.promote_to_crew(uuid, text, text, boolean) is
  'Brings a customer into the crew: role, market and optionally the market they lead, in one transaction and in the order the underlying rules require. Half of this has no client path otherwise.';

-- Who could be brought in: people who hold an account and a profile but are still customers. The
-- roster hides them by design; this names them so a UI can offer the door.
create or replace view public.v_promotable as
select p.id, p.display_name, p.referral_code, p.market,
       c.email, c.name as customer_name,
       (c.id is not null) as in_crm
  from public.profiles p
  left join public.customers c on c.user_id = p.id
 where coalesce(p.role, 'member') = 'member'
 order by coalesce(p.display_name, c.name, c.email);

revoke all on public.v_promotable from public, anon;
grant select on public.v_promotable to authenticated;

comment on view public.v_promotable is
  'Customers who already hold a profile and could be brought onto the crew. Fourteen of fifteen customers qualify; the roster filters every one of them out of sight.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('A customer can be brought onto the crew','improvement','Team',
   'Someone who buys from GT3 and someone who works for GT3 have always been the same record underneath, but the team roster filtered every customer out of view, so the one thing you could not do anywhere in the app was bring a person in. You can now, from the roster: pick the role, the city, and whether they lead it. All three land together or none of them do, because a half-promoted person reads the wrong city''s money.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify:
--   select * from public.v_promotable;
--   select public.promote_to_crew('<niño id>', 'operator', 'atlanta', true);
