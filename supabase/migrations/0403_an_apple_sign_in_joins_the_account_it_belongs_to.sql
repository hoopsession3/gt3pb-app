-- ── 0403 — AN APPLE SIGN-IN JOINS THE ACCOUNT IT BELONGS TO ─────────────────────────────────────────────────────────────
-- 2026-10-15 (A3 of the account audit; decided by Ryan on 2026-10-13: "right after a first Apple sign-in, offer 'Already a
-- member with another email? Link it', verified by a code sent to that email").
--
-- WHY. Sign in with Apple can hide a person's email behind a private relay address. Supabase links an Apple sign-in to the
-- account with the same email — and a relay address matches nobody's, so a member who joined with their email and then
-- tapped Continue with Apple got a second, empty account: none of their stamps, orders, rewards or referral code, and
-- nothing that linked the two (components/SignIn, lib/appleAuth; the audit's finding).
--
-- WHAT. Two questions only the server asks (app/api/account/link-apple, lib/appleLink):
--   · account_for_apple(sub) — the account an Apple ID signs in to, if one does (auth.identities: Apple's `sub` is the
--     identity's provider_id);
--   · account_unused(id) — whether an account holds nothing a person would lose: no order, payment, stamp, point, credit,
--     review, RSVP, referral, membership, reserve, photo or text sign-up. Found the way 0353 finds what to erase — every
--     foreign key in the schema that points at an account, a profile or a customer record, from the catalog, so a table
--     added later counts without anyone remembering it — less the rows signing in makes by itself (the profile and the
--     customer record handle_new_user writes, a phone's push registration, notification settings, page visits, a
--     reminder that cup orders opened, alert reads) and the Apple token the join carries across.
-- The joining itself is Supabase's own: the empty Apple account is deleted (0353's erasure, which finds nothing to keep),
-- and the Apple ID is linked to the member's account with Supabase's manual linking, so Continue with Apple opens it from
-- then on. Nothing here writes a row; both functions answer the server alone.
--
-- A second run changes nothing.
-- changelog: one line, below — the join is something a member sees.

-- 1 · The account an Apple ID signs in to.
create or replace function public.account_for_apple(p_sub text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select i.user_id from auth.identities i
   where i.provider = 'apple' and i.provider_id = p_sub
   order by i.user_id
   limit 1
$$;
comment on function public.account_for_apple(text) is
  'The account an Apple ID (Apple''s sub) signs in to, or null (0403). The server''s alone: app/api/account/link-apple.';

-- 2 · Whether an account holds nothing a person would lose.
create or replace function public.account_unused(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  -- What signing in makes by itself, and what nobody would miss: 'table.column' pairs, so a table named here still counts
  -- through any other column that points at the account (profiles.referred_by: someone they referred).
  v_made constant text[] := array[
    'profiles.id', 'customers.user_id', 'apple_tokens.user_id', 'push_subscriptions.user_id', 'notif_prefs.user_id',
    'user_activity.user_id', 'device_heartbeats.user_id', 'alert_reads.user_id', 'alert_snoozes.user_id', 'cup_reminders.user_id'];
  v_customers uuid[];
  v_hit       boolean;
  ref         record;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return false; end if;

  -- what the profile counts itself: points, credit, a founding place, a referral, a role, a photo
  if exists (select 1 from public.profiles p
              where p.id = p_user
                and (coalesce(p.points, 0) <> 0 or coalesce(p.credit_cents, 0) <> 0 or p.founding_member
                     or p.referred_by is not null or p.referral_converted or p.role is distinct from 'member'
                     or nullif(p.avatar_url, '') is not null)) then
    return false;
  end if;

  select coalesce(array_agg(id), '{}') into v_customers from public.customers where user_id = p_user;

  -- every row anywhere that points at the account, its profile or its customer record (0353's way: the catalog)
  for ref in
    select c.conrelid::regclass as rel, cl.relname::text as tbl, a.attname::text as col, c.confrelid as target
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.customers'::regclass)
  loop
    if ref.target = 'public.customers'::regclass then
      continue when cardinality(v_customers) = 0;
      execute format('select exists (select 1 from %s where %I = any($1))', ref.rel, ref.col) into v_hit using v_customers;
    else
      continue when (ref.tbl || '.' || ref.col) = any(v_made);
      execute format('select exists (select 1 from %s where %I = $1)', ref.rel, ref.col) into v_hit using p_user;
    end if;
    if v_hit then return false; end if;
  end loop;

  -- a photo of theirs in storage — the avatar and the VIP proof are written to `<user id>/…`
  if exists (select 1 from storage.objects o
              where o.bucket_id in ('avatars', 'vip') and o.name like p_user::text || '/%') then
    return false;
  end if;

  return true;
end $$;
comment on function public.account_unused(uuid) is
  'Whether an account holds nothing a person would lose (0403): the profile''s own counters, every foreign key that points at the account, its profile or its customer record, and its photos — less what signing in makes by itself. The server''s alone: app/api/account/link-apple.';

-- Only the server asks either one: Supabase grants a new function to anon and authenticated by name, so both are taken
-- back here, by name.
revoke all on function public.account_for_apple(text) from public, anon, authenticated;
grant execute on function public.account_for_apple(text) to service_role;
revoke all on function public.account_unused(uuid) from public, anon, authenticated;
grant execute on function public.account_unused(uuid) to service_role;

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Sign in with Apple finds the account you already have', 'feature', 'Account',
   'Joined GT3 with your email and then signed in with Apple, which can hide your email? Right after that first Apple sign-in, the app asks whether you are already a member: enter your email and the code we send it, and Continue with Apple opens your own account — stamps, orders and rewards included — from then on. Signed in with your email already? Settings & privacy has Link Sign in with Apple.',
   '2026-10-15', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- verify (numbers and booleans only):
--   select has_function_privilege('anon', 'public.account_unused(uuid)', 'execute');            -- false
--   select has_function_privilege('authenticated', 'public.account_for_apple(text)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.account_unused(uuid)', 'execute');    -- true
select public.record_migration('0403_an_apple_sign_in_joins_the_account_it_belongs_to');
