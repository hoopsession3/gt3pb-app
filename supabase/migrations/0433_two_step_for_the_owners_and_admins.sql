-- ── 0433 — TWO-STEP FOR THE OWNERS AND ADMINS ──────────────────────────────────────────────────────────────────────────
-- 2026-10-18. R28 of the 10/10 audit (security F6; Ryan, 2026-10-18: "Yes, owner/admin"). Paste into Supabase → SQL
-- Editor → Run. A second run changes nothing.
--
-- WHY. An owner's or an admin's password, or a code read off their email, is everything: refunds, the books, every
-- customer, the crew's roles and offer letters. Supabase has a second step built in — an authenticator app's six-digit
-- code (TOTP; Authentication → Multi-Factor says it is on for this project) — and nothing in the app asked for it, or
-- held an owner's or admin's powers to it.
--
-- WHAT.
--   · two_step_ok(): the caller has given the second step on this sign-in (the token's aal is aal2) — or has no
--     authenticator set up and nobody requires one. One question, asked by the two gates below.
--   · is_admin() and is_owner() — 0035's and 0023's, the gates every owner and admin power asks (171 places: policies,
--     functions, and the app's server through lib/apiAuth) — answer yes only with two_step_ok() as well. An owner or
--     admin who set up an authenticator is an owner or admin on a sign-in that gave its code, and crew (is_staff) on one
--     that didn't, until they give it. Nothing changes for anyone who hasn't set one up.
--   · two_step_settings: whether this business requires the second step of every owner and admin. Off until an owner
--     turns it on — require_two_step(true) — which only an owner who has set up an authenticator and given its code on
--     this sign-in may do, so turning it on can't lock its owner out. On, an owner or admin without an authenticator is
--     crew until they set one up (setting one up asks for no owner's power). Off again: an owner, on a sign-in with its
--     code.
--   · two_step_state(): what the app needs to ask — whether the caller is an owner or admin, has an authenticator,
--     gave its code on this sign-in, whether the business requires it — for the caller alone; no secret, no factor's id.
--
-- NO LOCKOUT. Before anyone sets up an authenticator nothing changes. An owner who loses theirs: Supabase → Authentication
-- → Users → the owner → remove the factor (the dashboard needs no app); they are an owner again on their next sign-in, and
-- set a new one up.
--
-- ORDER. Paste it right after the deploy that carries Settings & privacy → Two-step sign-in and the code prompt
-- (components/TwoStep*): before that deploy nobody can set an authenticator up from the app, and before this paste one set
-- up from it asks for its code and holds no power to it yet.
-- set lock_timeout (database F16): two functions made again, a small table, two more functions — a moment's lock each.
-- existing rows: none.
-- changelog: below.

set lock_timeout = '5s';

create table if not exists public.two_step_settings (
  tenant_id   uuid primary key references public.tenants(id),
  required    boolean not null default false,
  set_by      uuid references auth.users(id) on delete set null,
  set_at      timestamptz not null default now()
);
create index if not exists two_step_settings_set_by on public.two_step_settings (set_by);
comment on table public.two_step_settings is
  'Whether a business requires the second step (an authenticator''s code) of every owner and admin (0433). Read by two_step_ok(); written only by require_two_step().';
alter table public.two_step_settings enable row level security;
drop policy if exists "tenant isolation" on public.two_step_settings;
create policy "tenant isolation" on public.two_step_settings as restrictive for all
  using (tenant_id = (select public.effective_tenant())) with check (tenant_id = (select public.effective_tenant()));
revoke all on public.two_step_settings from public, anon, authenticated;

-- ── the one question ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_ok() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
          and not coalesce((select s.required from public.two_step_settings s
                             where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false))
$$;
revoke all on function public.two_step_ok() from public, anon, authenticated;
grant execute on function public.two_step_ok() to authenticated, service_role;
comment on function public.two_step_ok() is
  'Whether the caller has given the second step on this sign-in (aal2) — or has no authenticator set up and their business does not require one (0433). is_admin() and is_owner() ask it.';

-- ── the two gates, each 0035's and 0023's but the question ─────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role in ('admin','owner') or is_admin = true)
  ) and public.two_step_ok();
$$;

create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false) and public.two_step_ok();
$$;

-- ── what the app asks ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.two_step_state() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leader',   coalesce((select p.role in ('owner', 'admin') or coalesce(p.is_admin, false) from public.profiles p where p.id = (select auth.uid())), false),
    'owner',    coalesce((select p.role = 'owner' from public.profiles p where p.id = (select auth.uid())), false),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'given',    coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2',
    'required', coalesce((select s.required from public.two_step_settings s
                           where s.tenant_id = (select p.tenant_id from public.profiles p where p.id = (select auth.uid()))), false),
    'ok',       public.two_step_ok())
$$;
revoke all on function public.two_step_state() from public, anon, authenticated;
grant execute on function public.two_step_state() to authenticated;
comment on function public.two_step_state() is
  'The second step, for the caller alone (0433): owner or admin, an authenticator set up, its code given on this sign-in, required by their business, and whether their owner and admin powers stand. No secret and no factor''s id.';

create or replace function public.require_two_step(p_on boolean) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if p_on is null then raise exception 'Say on or off.' using errcode = '22023'; end if;
  -- An owner, on a sign-in that gave its code, with an authenticator of their own: so the owner turning it on has one,
  -- and has just used it (GoTrue gives aal2 only for a code; the factor is asked too, as a second word for it).
  if not public.is_owner() or coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2'
     or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified') then
    raise exception 'Only an owner, signed in with their authenticator''s code, sets this.' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id = (select auth.uid());
  insert into public.two_step_settings (tenant_id, required, set_by, set_at)
  values (v_tenant, p_on, (select auth.uid()), now())
  on conflict (tenant_id) do update set required = excluded.required, set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('ok', true, 'required', p_on);
end $$;
revoke all on function public.require_two_step(boolean) from public, anon, authenticated;
grant execute on function public.require_two_step(boolean) to authenticated;
comment on function public.require_two_step(boolean) is
  'Require the second step of every owner and admin of the caller''s business, or stop requiring it (0433): an owner, on a sign-in that gave their authenticator''s code, only.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Two-step sign-in for owners and admins', 'security', 'Account',
   'Owners and admins can add an authenticator app in Settings & privacy. Once it''s on, the money, the books, customers and the crew''s roles ask for its six-digit code once each sign-in — a password or an emailed code alone isn''t enough. An owner can require it of every owner and admin.',
   '2026-10-18', false)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select prosrc like '%two_step_ok%' from pg_proc where proname in ('is_admin', 'is_owner');                  -- t, t
--   select has_function_privilege('anon', 'public.two_step_state()', 'execute');                                 -- f
--   select relrowsecurity from pg_class where oid = 'public.two_step_settings'::regclass;                        -- t
--   select count(*) from public.two_step_settings where required;                                                -- 0
select public.record_migration('0433_two_step_for_the_owners_and_admins');
reset lock_timeout;   -- the paste's own wait, not the next query's in this editor
