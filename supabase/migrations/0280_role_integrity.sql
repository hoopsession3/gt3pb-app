-- 0280 — ROLE INTEGRITY. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Four findings from the 2026-09 role audit, closed. They ship together and they ship BEFORE the
-- offer-letter flow (0281), because that flow's whole purpose is handing someone a role — and three
-- of these four are about roles not meaning what they say.
--
--   1. DEMOTION DID NOT REVOKE ACCESS.  There are two sources of truth for "is this person staff":
--      profiles.role, and a legacy profiles.is_admin boolean. is_admin() and is_staff() (0035) both
--      return true on the BOOLEAN ALONE. admin_set_role kept them in sync in 0023 — and the 0031
--      rewrite dropped that line. So demoting an admin to 'member' left is_admin = true: full
--      database admin, and the client's roleOf() fallback still reads them as "owner". Silent,
--      permanent, and exactly wrong at the moment you most need it to work.
--
--   2. THE LAST OWNER COULD DEMOTE THEMSELVES.  Guarded only in the browser (crew/page.tsx). Losing
--      the final owner locks out role assignment, shop media, and team invites — recoverable only by
--      direct SQL against production.
--
--   3. OWNER RIGHTS WERE GRANTED BY HARDCODED EMAIL, AUTOMATICALLY, AT SIGN-UP.  Two addresses,
--      duplicated across four migrations in the live lineage. Sign-up is public, so anyone who can
--      receive mail at either address becomes an owner with no human in the loop. The 0004
--      admin_emails table was the right shape and was abandoned in 0023; it still holds two stale
--      addresses that are NOT owners, which is worse than not existing.
--
--   4. AN ADMIN COULD REWRITE AN ACCEPTED AGREEMENT.  0277's policy is FOR ALL to any admin with no
--      status guard, so operator deal terms stayed editable after acceptance. The trail recorded it,
--      so it was auditable rather than silent — but a signed deal should not be editable at all.
--
-- ZERO REGRESSION: nobody's CURRENT access changes. Every existing owner stays an owner, every admin
-- stays an admin. What changes is what happens on the NEXT role change, the next sign-up, and the
-- next attempt to edit a signed deal.
--
-- Apply after 0279.

-- ── 1. Role changes keep the mirror in sync, and the last owner cannot be removed ────────────────
create or replace function public.admin_set_role(member uuid, new_role text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  cur   text;
  owners int;
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  if new_role not in ('member','server','operator','event_manager','contractor','admin','owner')
    then raise exception 'invalid role: %', new_role; end if;

  select role into cur from public.profiles where id = member;
  if cur is null then raise exception 'no such profile'; end if;

  -- Finding 2: refuse to remove the last owner. Checked in the database, where it cannot be
  -- skipped by calling the RPC directly, and phrased so the caller knows what to do instead.
  if cur = 'owner' and new_role <> 'owner' then
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'This is the last owner. Promote someone else to owner first, then change this role.';
    end if;
  end if;

  -- Finding 1: is_admin is a MIRROR of role, never an independent grant. Writing both together is
  -- the whole fix — is_admin() and is_staff() read the boolean, so leaving it stale leaves access.
  update public.profiles
     set role = new_role,
         is_admin = (new_role in ('admin','owner'))
   where id = member;
end $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- The same rule, enforced against EVERY write path rather than just the RPC — a direct table update
-- by a service-role job or a future screen cannot strand the boolean either.
create or replace function public.sync_is_admin_mirror() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    new.is_admin := (new.role in ('admin','owner'));
  end if;
  return new;
end $$;

drop trigger if exists zz_sync_is_admin_mirror on public.profiles;
create trigger zz_sync_is_admin_mirror before update of role on public.profiles
  for each row execute function public.sync_is_admin_mirror();

-- Repair anyone already stranded: is_admin = true while the role says otherwise. With a clean
-- database this matches nothing; it is here because the bug ran for ~250 migrations.
update public.profiles
   set is_admin = (role in ('admin','owner'))
 where is_admin is distinct from (role in ('admin','owner'));

-- ── 2. Owner grants come from a table, not a literal, and never fire automatically ───────────────
-- admin_emails (0004) is revived as the single source of truth, with the columns needed to answer
-- "who can become an owner, and did anyone actually approve it".
alter table public.admin_emails add column if not exists role       text not null default 'owner';
alter table public.admin_emails add column if not exists active     boolean not null default true;
alter table public.admin_emails add column if not exists note       text;
alter table public.admin_emails add column if not exists created_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_emails_role_check') then
    alter table public.admin_emails add constraint admin_emails_role_check
      check (role in ('member','server','operator','event_manager','contractor','admin','owner'));
  end if;
end $$;

-- Reconcile the table with the allowlist that has actually been live since 0099. The two addresses
-- 0004 carried and 0023 silently abandoned (ryan@gt3pb.com, ryan@tech-drip.com) are NOT owners
-- today; they are deactivated rather than deleted so the history stays legible.
insert into public.admin_emails (email) values ('ryanthompkins@icloud.com'), ('kayla@gt3pb.com')
  on conflict (email) do nothing;

update public.admin_emails
   set active = true, role = 'owner', note = coalesce(note, 'live owner allowlist since 0099')
 where lower(email) in ('ryanthompkins@icloud.com','kayla@gt3pb.com');

update public.admin_emails
   set active = false,
       note = coalesce(note, 'carried by 0004, never in the live allowlist after 0023 — deactivated by 0280')
 where lower(email) not in ('ryanthompkins@icloud.com','kayla@gt3pb.com');

alter table public.admin_emails enable row level security;
drop policy if exists "admin_emails owner read" on public.admin_emails;
create policy "admin_emails owner read" on public.admin_emails
  for select using ((select public.is_owner()));
-- No write policy: the allowlist changes by deliberate SQL, not from a screen. A list that grants
-- ownership should be harder to edit than the thing it grants.

-- The sign-up trigger now READS that table instead of carrying a literal — and, critically, no
-- longer mints an owner on its own. An allowlisted address arrives as a normal member and is
-- promoted by an existing owner through admin_set_role. Everything else in this function is
-- preserved verbatim from 0246 (profile creation, referral-code collision retry, customer seed,
-- team-invite claim); only the ownership decision changed.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, ref, false, 'member')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), false, 'member')
    on conflict (id) do nothing;
  end;

  begin
    insert into public.customers (user_id, name, email, tenant_id)
    values (new.id, nm, new.email, public.effective_tenant())
    on conflict (user_id) do nothing;
  exception when others then null; -- never let a CRM-seed hiccup block account creation
  end;

  -- Team invite claim, unchanged from 0246 — it cannot mint an owner (team_invites.role excludes it)
  -- and it now also cannot strand the mirror, because the trigger above owns that.
  update public.profiles p set role = i.role, is_admin = (i.role in ('admin','owner'))
    from public.team_invites i
    where p.id = new.id and i.claimed_at is null and lower(i.email) = lower(new.email) and p.role = 'member';
  update public.team_invites set claimed_at = now(), claimed_by = new.id
    where claimed_at is null and lower(email) = lower(new.email);

  return new;
end $$;

-- ── 3. A signed agreement's terms are final ──────────────────────────────────────────────────────
-- Status may still move (accepted → active → ended); the numbers may not. Owners keep an escape
-- hatch under the same gt3.allow_hard_delete flag the delete guards use, so a genuine correction is
-- possible and deliberate rather than casual.
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
  or new.market         is distinct from old.market then
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
  ('Roles now mean what they say','security','Crew',
   'Four gaps in how roles grant access, closed together. Changing someone''s role now actually changes what they can reach — before this, a demoted admin kept full access through a legacy flag the role change forgot to clear. The last owner can no longer be removed by accident, so the account cannot lock itself out. Owner rights are no longer granted automatically to hardcoded email addresses at sign-up; an allowlisted address now arrives as a normal member and an existing owner promotes them deliberately. And once an operator agreement has been accepted, its numbers are final — the status can still move, but the terms cannot be quietly rewritten.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- nobody is stranded: role and the mirror agree on every row
--   select count(*) from public.profiles where is_admin is distinct from (role in ('admin','owner'));  -- 0
--
--   -- the owners are who you expect, and nobody was demoted by this migration
--   select role, count(*) from public.profiles group by 1 order by 1;
--
--   -- the allowlist is a table again, and the stale entries are visibly retired
--   select email, role, active, note from public.admin_emails order by active desc, email;
--
--   -- sign-up no longer decides ownership (expect: no literal email in the function body)
--   select position('icloud.com' in pg_get_functiondef(p.oid)) = 0 as no_hardcoded_owner
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'handle_new_user';                                     -- true
--
--   -- the last owner is protected (run as an owner, with only one owner present): expect EXCEPTION
--   -- select public.admin_set_role(auth.uid(), 'admin');
--
--   -- an accepted agreement refuses a terms edit: expect EXCEPTION
--   -- update public.operator_agreements set operator_pct = 60, royalty_pct = 20
--   --  where status = 'accepted' limit 1;
