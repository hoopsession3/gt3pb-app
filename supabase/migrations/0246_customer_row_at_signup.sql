-- 0246 — seed the customer-book row at SIGNUP, not just at first order.
--
-- Ryan (2026-07-28): a customer emailed saying she'd created an account, but he couldn't find her
-- in the crew Customer book to upgrade her to Founding ("VIP" in his words — this app's actual top
-- tier, see 0176). Root cause, traced end to end:
--   - handle_new_user() (the auth signup trigger) has only ever inserted into public.profiles.
--     That's enough for the customer-facing app: she signs in, sees "Morning, Gianna," her stamp
--     card, everything — profiles is all the customer-facing UI reads.
--   - public.customers — the table CrmPanel.tsx ("Customer book") reads, and the ONLY table
--     admin_set_customer_tier()/admin_set_member() operate on — is populated exclusively by
--     resolve_customer(), which only the ORDER-placing API routes call. CrmPanel's own empty state
--     says it plainly: "They appear with their first order." A signed-up, never-ordered customer
--     has no customers row at all, so there's nothing for the tier toggle in CrmDetail to act on —
--     admin_set_customer_tier would just UPDATE zero rows, silently.
-- Fix: insert a customers row the moment the account exists, same shape resolve_customer() would
-- create (user_id, name, email, tenant_id — phone stays null, filled in later by an actual order).
-- resolve_customer() already treats an existing user_id match as authoritative and only enriches it
-- (coalesce, never overwrites), so this can never create a duplicate once she does order — it only
-- moves "when does she first appear in the Customer book" earlier, from first order to signup.
-- Wrapped in its own exception handler: a CRM-seed hiccup must never block account creation, the
-- single most sensitive path in the app.
--
-- Also backfills every EXISTING account holder who, like this customer, signed up before an order —
-- so she (and anyone else in the same boat today) shows up the moment this migration runs, not just
-- for signups from here on.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text; base text; ref text; is_own boolean;
begin
  is_own := lower(new.email) in ('ryanthompkins@icloud.com', 'kayla@gt3pb.com');   -- the 0099 owner allowlist, preserved
  nm := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), initcap(split_part(new.email, '@', 1)));
  base := upper(regexp_replace(split_part(nm, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
  if base = '' then base := 'GT3'; end if;
  ref := left(base, 8) || '-' || upper(substr(md5(new.id::text), 1, 4));
  begin
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, ref, is_own, case when is_own then 'owner' else 'member' end)
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, display_name, referral_code, is_admin, role)
    values (new.id, nm, left(base, 8) || '-' || upper(substr(md5(new.id::text || clock_timestamp()::text), 1, 8)), is_own, case when is_own then 'owner' else 'member' end)
    on conflict (id) do nothing;
  end;

  -- NEW (0246): seed the Customer book row now, not on first order — see header.
  begin
    insert into public.customers (user_id, name, email, tenant_id)
    values (new.id, nm, new.email, public.effective_tenant())
    on conflict (user_id) do nothing;
  exception when others then null; -- never let a CRM-seed hiccup block account creation
  end;

  -- Claim a pending team invite: the invited email lands with its pre-assigned role. Never touches
  -- the owner, and only ever upgrades a fresh 'member' profile (an existing staff role stays put).
  update public.profiles p set role = i.role, is_admin = (i.role = 'admin')
    from public.team_invites i
    where p.id = new.id and i.claimed_at is null and lower(i.email) = lower(new.email) and p.role = 'member';
  update public.team_invites set claimed_at = now(), claimed_by = new.id
    where claimed_at is null and lower(email) = lower(new.email);
  return new;
end; $$;

-- Backfill: every current account holder who has no customers row yet (signed up, never ordered).
-- Inner join on purpose — a profiles row should always have a matching auth.users row by
-- construction (profiles.id = auth.users.id), so this only ever skips a genuine orphan, never a
-- real account.
insert into public.customers (user_id, name, email, tenant_id)
select p.id, p.display_name, u.email, coalesce(p.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid)
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do nothing;

-- verify:
--   select prosrc like '%NEW (0246)%' from pg_proc where proname = 'handle_new_user';                -- true
--   select count(*) from public.profiles p where not exists
--     (select 1 from public.customers c where c.user_id = p.id);                                      -- 0
--   -- find today's customer by name/email now that she has a row:
--   select id, user_id, name, email, tier from public.customers where email ilike '%gianna%' or name ilike '%gianna%';
