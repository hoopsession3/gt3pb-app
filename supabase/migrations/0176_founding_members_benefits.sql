-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0176 · FOUNDING MEMBERS + DYNAMIC BENEFITS — tier the customer, and let the owner mint ANY perk
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Two things: (1) a tier on the customer record (guest → member → founding), and (2) a benefits
-- table that turns "founding members get free straight-brew refills and $8 lattes" into DATA the
-- owner edits — not code. A benefit is a rule: scope (a tier, or a redeemable code) × kind
-- (free_refill | price_override | percent_off) × target (a product slug, the 'straight_brew'
-- family, or null = everything) × value. The server reads these at pricing time (lib/benefits.ts);
-- adding a new perk or a new code is an INSERT, never a deploy.

alter table public.customers add column if not exists tier text not null default 'guest'
  check (tier in ('guest', 'member', 'founding'));
create index if not exists customers_tier on public.customers(tier) where tier <> 'guest';

create table if not exists public.member_benefits (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  scope       text not null check (scope in ('tier', 'code')),
  tier        text check (tier in ('member', 'founding')),      -- when scope='tier'
  code        text,                                             -- when scope='code' (redeemable)
  kind        text not null check (kind in ('free_refill', 'price_override', 'percent_off')),
  target      text,                     -- product slug | 'straight_brew' (rise/flow/dusk) | null = all
  value_cents int,                      -- for price_override (e.g. 800 = $8)
  percent     int,                      -- for percent_off (e.g. 15)
  label       text not null,            -- owner-facing name
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- a scope names exactly its own key
  constraint member_benefits_scope_key check (
    (scope = 'tier' and tier is not null and code is null) or
    (scope = 'code' and code is not null and tier is null)
  )
);
create unique index if not exists member_benefits_code on public.member_benefits(lower(code)) where code is not null;
create index if not exists member_benefits_tier on public.member_benefits(tier) where tier is not null;

alter table public.member_benefits enable row level security;
-- Perks aren't secret — any signed-in customer may read the ACTIVE ones (the storefront shows them).
drop policy if exists "benefits read active" on public.member_benefits;
create policy "benefits read active" on public.member_benefits for select
  to authenticated using (active or (select public.is_staff()));
drop policy if exists "benefits staff write" on public.member_benefits;
create policy "benefits staff write" on public.member_benefits for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

drop trigger if exists stamp_tenant_tg on public.member_benefits;
create trigger stamp_tenant_tg before insert on public.member_benefits for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.member_benefits;
create policy "tenant isolation" on public.member_benefits as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- The two founding perks the owner named, seeded (idempotent by label).
insert into public.member_benefits (scope, tier, kind, target, value_cents, label)
select 'tier', 'founding', 'free_refill', 'straight_brew', null, 'Founding · free straight-brew refills'
where not exists (select 1 from public.member_benefits where label = 'Founding · free straight-brew refills');
insert into public.member_benefits (scope, tier, kind, target, value_cents, label)
select 'tier', 'founding', 'price_override', 'maple', 800, 'Founding · $8 Salted Maple Latte'
where not exists (select 1 from public.member_benefits where label = 'Founding · $8 Salted Maple Latte');
insert into public.member_benefits (scope, tier, kind, target, value_cents, label)
select 'tier', 'founding', 'price_override', 'salted-latte', 800, 'Founding · $8 latte (bulk)'
where not exists (select 1 from public.member_benefits where label = 'Founding · $8 latte (bulk)');

-- A signed-in caller's own active benefits (tier perks + any code they redeem is applied server-side).
create or replace function public.my_member_benefits() returns setof public.member_benefits
  language sql stable security definer set search_path = public as $$
  select b.* from public.member_benefits b
  join public.customers c on c.user_id = auth.uid()
  where b.active and b.scope = 'tier' and b.tier = c.tier;
$$;

-- verify:
--   select count(*) from information_schema.columns where table_name='customers' and column_name='tier';  -- 1
--   select count(*) from public.member_benefits where tier='founding' and active;                          -- 3
--   select count(*) from pg_policies where tablename='member_benefits';                                    -- 3

-- Reconcile with the existing profiles.founding_member boolean (the loyalty model): carry any
-- current founding members onto the new tier, and give the crew one RPC that sets the tier AND
-- mirrors the boolean, so the two never drift.
update public.customers c set tier = 'founding'
  from public.profiles p where p.id = c.user_id and p.founding_member = true and c.tier <> 'founding';

create or replace function public.admin_set_customer_tier(p_user uuid, p_tier text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_tier not in ('guest', 'member', 'founding') then raise exception 'bad tier'; end if;
  update public.customers set tier = p_tier, updated_at = now() where user_id = p_user;
  update public.profiles  set founding_member = (p_tier = 'founding') where id = p_user;
end; $$;
revoke all on function public.admin_set_customer_tier(uuid, text) from public, anon;

-- verify (append):
--   select count(*) from pg_proc where proname='admin_set_customer_tier';                                  -- 1
