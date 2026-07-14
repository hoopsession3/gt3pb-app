-- 0221 — Teammate invites + office payment links (the two launch-month capabilities).
--
-- (1) TEAM INVITES — the team goes 2 → 4-5 this month, and onboarding was "they self-signup as a
--     member, then the owner finds them in the roster and promotes them." Now the owner invites an
--     email WITH a role; the moment that person signs up (any method), handle_new_user claims the
--     invite and lands them in the right role. Owner-only to write (same power as role assignment).
--
-- (2) OFFICE PAYMENT LINKS — prepaid office orders were paid via links crew texted by hand from
--     Square, so the app never saw the payment id (the one gap in the walk-up dedupe, 0220). Now the
--     app creates the Square payment link itself (/api/office/paylink), stores the Square order id,
--     and the webhook auto-marks the order paid + stores payment_id when the customer pays. Closes
--     the loop: no hand-marking, no double-count.
-- Idempotent + additive.

-- ── (1) team invites ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  email       text not null,
  role        text not null default 'server' check (role in ('server','contractor','operator','event_manager','admin')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  claimed_by  uuid references auth.users(id) on delete set null
);
create unique index if not exists team_invites_email_idx on public.team_invites (lower(email)) where claimed_at is null;   -- ONE open invite per email → deterministic role

drop trigger if exists stamp_tenant_tg on public.team_invites;
create trigger stamp_tenant_tg before insert on public.team_invites
  for each row execute function public.stamp_tenant();

alter table public.team_invites enable row level security;
drop policy if exists "invites leadership read" on public.team_invites;
create policy "invites leadership read" on public.team_invites for select using ((select public.is_admin()));
drop policy if exists "invites owner write" on public.team_invites;
create policy "invites owner write" on public.team_invites for all
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists "tenant isolation" on public.team_invites;
create policy "tenant isolation" on public.team_invites as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.team_invites to authenticated;
do $pub$ begin alter publication supabase_realtime add table public.team_invites; exception when duplicate_object then null; end $pub$;

-- handle_new_user: same as the LIVE 0099 version (incl. Kayla in the owner allowlist), plus the
-- invite claim at the end. NOTE (conscious): the claim fires at auth.users INSERT — before email
-- confirmation — but magic-link sign-in already requires inbox access to get a session.
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
  -- Claim a pending team invite: the invited email lands with its pre-assigned role. Never touches
  -- the owner, and only ever upgrades a fresh 'member' profile (an existing staff role stays put).
  update public.profiles p set role = i.role, is_admin = (i.role = 'admin')
    from public.team_invites i
    where p.id = new.id and i.claimed_at is null and lower(i.email) = lower(new.email) and p.role = 'member';
  update public.team_invites set claimed_at = now(), claimed_by = new.id
    where claimed_at is null and lower(email) = lower(new.email);
  return new;
end; $$;

-- ── (2) office ↔ Square linkage ───────────────────────────────────────────────────────────────────
alter table public.business_orders add column if not exists square_order_id text;
alter table public.business_orders add column if not exists paylink_url text;
create index if not exists business_orders_sq_order_idx on public.business_orders (square_order_id) where square_order_id is not null;

-- verify:
--   select to_regclass('public.team_invites');                                                        -- not null
--   select prosrc like '%team_invites%' from pg_proc where proname = 'handle_new_user';               -- true
--   select count(*) from information_schema.columns where table_name='business_orders' and column_name in ('square_order_id','paylink_url'); -- 2
