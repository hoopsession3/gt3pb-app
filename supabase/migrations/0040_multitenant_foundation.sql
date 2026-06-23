-- 0040 — MULTI-TENANT FOUNDATION (non-breaking). Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Lays the tenancy spine WITHOUT flipping per-tenant RLS enforcement (that's a separate, tested
-- follow-up). All existing rows backfill to the founding GT3PB tenant; new rows default to it.
-- This is purely additive (nullable-with-default columns + a helper) and fully reversible.

create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  brand       text,
  created_at  timestamptz not null default now()
);

-- Founding tenant. Fixed UUID so backfills + app code reference it deterministically.
insert into public.tenants (id, slug, name, brand)
values ('00000000-0000-0000-0000-000000000001', 'gt3pb', 'GT3 Performance Bar', 'GT3 Performance Bar')
on conflict (id) do nothing;

-- Tenants readable by staff; writes happen via migration only (no write policy).
alter table public.tenants enable row level security;
drop policy if exists "tenants staff read" on public.tenants;
create policy "tenants staff read" on public.tenants for select using ((select public.is_staff()));

-- Users belong to a tenant.
alter table public.profiles add column if not exists tenant_id uuid references public.tenants(id)
  default '00000000-0000-0000-0000-000000000001';
update public.profiles set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;

-- current_tenant(): the calling user's tenant. (select auth.uid()) wrap = plan-stable (see 0039).
create or replace function public.current_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = (select auth.uid());
$$;

-- Add tenant_id (+ backfill + index) to every business table that exists. Guarded by to_regclass
-- so it's safe regardless of which optional migrations a given project has applied.
do $$
declare
  t text;
  tables text[] := array[
    'events','event_tasks','event_staff','event_approvals','event_sales','event_economics',
    'orders','subscriptions','subscription_interest','booking_requests','reserves','reserve_claims',
    'product_economics','stops','live_status','vendors','compliance_rules','trailer_profile',
    'push_subscriptions','check_ins','rsvps','referral_events','live_truck','order_items',
    'academy_certifications','academy_assignments','academy_progress','academy_acknowledgements'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) default %L', t, '00000000-0000-0000-0000-000000000001');
      execute format('update public.%I set tenant_id = %L where tenant_id is null', t, '00000000-0000-0000-0000-000000000001');
      execute format('create index if not exists %I on public.%I(tenant_id)', t||'_tenant_idx', t);
    end if;
  end loop;
end $$;
