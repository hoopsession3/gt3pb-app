-- 0013 — referral attribution + auto-credit (Supabase only; Square has no referral
-- primitive and Square Loyalty would duplicate our credit_cents/points wallet).
-- Conversion is gated on the operator's pickup (status->done), like loyalty (0012),
-- so it is unforgeable without any server-side paid-order write.

-- attribution edge + one-time conversion latch
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id);
alter table public.profiles add column if not exists referral_converted boolean not null default false;
alter table public.profiles drop constraint if exists no_self_referral;
alter table public.profiles add constraint no_self_referral check (referred_by is null or referred_by <> id);

-- audit ledger: one paid conversion per referee, ever
create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referrer uuid not null references public.profiles(id),
  referee  uuid not null references public.profiles(id) unique,
  code_used text,
  converting_order uuid references public.orders(id),
  referrer_credit_cents int not null,
  referee_credit_cents  int not null,
  created_at timestamptz not null default now()
);
alter table public.referral_events enable row level security;
drop policy if exists "referral read" on public.referral_events;
create policy "referral read" on public.referral_events for select
  using (auth.uid() = referrer or auth.uid() = referee or public.is_admin());
-- no client INSERT/UPDATE/DELETE: only the SECURITY DEFINER trigger writes here.

-- attach a referrer to the current user: write-once, no self, before any conversion.
-- Only path that can set referred_by (column is never in the display_name-only grant).
create or replace function public.attach_referral(code text)
returns void language plpgsql security definer set search_path = public as $$
declare ref uuid;
begin
  if code is null or btrim(code) = '' then return; end if;
  select id into ref from public.profiles where referral_code = upper(btrim(code));
  if ref is null or ref = auth.uid() then return; end if;
  update public.profiles
    set referred_by = ref
    where id = auth.uid() and referred_by is null and referral_converted = false;
end; $$;
grant execute on function public.attach_referral(text) to authenticated;

-- loyalty (existing) + referral conversion, both on operator pickup (status->done).
create or replace function public.award_points() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ref uuid;
  existing int := 0;
  grant_cents int := 500;  -- give $5 / get $5
  floor_cents int := 500;  -- conversion requires a real purchase
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.user_id is not null then
    update public.profiles
      set points = points + greatest(coalesce(array_length(new.items, 1), 1), 1)
      where id = new.user_id;

    select referred_by into ref from public.profiles
      where id = new.user_id and referred_by is not null and referral_converted = false;
    if ref is not null and new.total_cents >= floor_cents then
      select count(*) into existing from public.referral_events where referee = new.user_id;
      if existing = 0 then
        update public.profiles set referral_converted = true, credit_cents = credit_cents + grant_cents where id = new.user_id;
        update public.profiles set credit_cents = credit_cents + grant_cents where id = ref;
        insert into public.referral_events (referrer, referee, converting_order, referrer_credit_cents, referee_credit_cents)
          values (ref, new.user_id, new.id, grant_cents, grant_cents);
      end if;
    end if;
  end if;
  return new;
end; $$;
