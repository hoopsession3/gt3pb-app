-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0151 · CUSTOMER IDENTITY SPINE  (Layer 1, Phase 1 of the commerce cohesion rebuild)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The audit's root cause: the same human is keyed six different ways across five order tables, with
-- no record joining them — so loyalty/referral only ever see cup orders, and a member's delivery +
-- pack spend earns nothing. This adds ONE canonical customer that every order references.
--
-- 100% ADDITIVE + backwards-compatible: a new table, new NULLABLE customer_id columns, a find-or-
-- create resolver, and a backfill that only fills nulls. user_id stays on every table; nothing is
-- dropped or rewritten. Safe to apply on live data; reversible by dropping the new objects.

-- ── 1. the canonical customer ────────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete set null,  -- set once the human signs in
  name        text,
  phone       text,
  email       text,
  tenant_id   uuid,                                    -- forward-compat with the 0134 tenant model
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Match on normalized contact info (digits-only phone, lowercased email).
create index if not exists customers_phone_idx on public.customers (regexp_replace(coalesce(phone,''), '\D', '', 'g')) where phone is not null;
create index if not exists customers_email_idx on public.customers (lower(email)) where email is not null;

alter table public.customers enable row level security;
drop policy if exists "customers own read" on public.customers;
create policy "customers own read" on public.customers for select using (user_id = (select auth.uid()));
drop policy if exists "customers staff read" on public.customers;
create policy "customers staff read" on public.customers for select using ((select public.is_staff()));
-- writes are server-only (service role + the definer resolver below); no client insert/update policy.

-- ── 2. every order table gets a nullable link (keep user_id too) ─────────────────────────────────
alter table public.orders          add column if not exists customer_id uuid references public.customers(id);
alter table public.drop_orders     add column if not exists customer_id uuid references public.customers(id);
alter table public.delivery_orders add column if not exists customer_id uuid references public.customers(id);
alter table public.reserve_claims  add column if not exists customer_id uuid references public.customers(id);
alter table public.subscriptions   add column if not exists customer_id uuid references public.customers(id);
create index if not exists orders_customer_idx          on public.orders(customer_id);
create index if not exists drop_orders_customer_idx     on public.drop_orders(customer_id);
create index if not exists delivery_orders_customer_idx on public.delivery_orders(customer_id);

-- ── 3. the resolver: find-or-create by user_id → phone → email, refreshing contact info ──────────
-- The one entry point the order APIs call. Strongest signal first (account), then phone, then email.
-- Prefers an account-linked customer when several match, so a guest's phone/email folds into their
-- member record once they sign up. security definer so the service role and backfill can create rows.
create or replace function public.resolve_customer(p_user_id uuid, p_phone text, p_email text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; norm_phone text; norm_email text;
begin
  norm_phone := nullif(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '');
  norm_email := nullif(lower(trim(coalesce(p_email,''))), '');

  if p_user_id is not null then
    select id into cid from public.customers where user_id = p_user_id limit 1;
  end if;
  if cid is null and norm_phone is not null then
    select id into cid from public.customers
      where regexp_replace(coalesce(phone,''), '\D', '', 'g') = norm_phone
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;
  if cid is null and norm_email is not null then
    select id into cid from public.customers
      where lower(email) = norm_email
      order by (user_id is not null) desc, created_at asc limit 1;
  end if;

  if cid is null then
    insert into public.customers (user_id, name, phone, email)
      values (p_user_id, nullif(trim(coalesce(p_name,'')),''), p_phone, norm_email)
      returning id into cid;
  else
    -- keep the canonical row current + attach the account the moment we learn it
    update public.customers set
      user_id    = coalesce(user_id, p_user_id),
      name       = coalesce(name, nullif(trim(coalesce(p_name,'')),'')),
      phone      = coalesce(phone, p_phone),
      email      = coalesce(email, norm_email),
      updated_at = now()
    where id = cid;
  end if;
  return cid;
end $$;
revoke execute on function public.resolve_customer(uuid, text, text, text) from anon, authenticated;
grant  execute on function public.resolve_customer(uuid, text, text, text) to service_role;

-- ── 4. backfill (idempotent — only touches null customer_id) ─────────────────────────────────────
-- 4a. one customer per existing member, carrying their account + email.
insert into public.customers (user_id, name, email)
  select p.id, p.display_name, u.email
    from public.profiles p left join auth.users u on u.id = p.id
  on conflict (user_id) do nothing;

-- 4b. link every member order to that customer.
update public.orders          o set customer_id = c.id from public.customers c where o.user_id = c.user_id and o.user_id is not null and o.customer_id is null;
update public.drop_orders     o set customer_id = c.id from public.customers c where o.user_id = c.user_id and o.user_id is not null and o.customer_id is null;
update public.delivery_orders o set customer_id = c.id from public.customers c where o.user_id = c.user_id and o.user_id is not null and o.customer_id is null;
update public.reserve_claims  o set customer_id = c.id from public.customers c where o.user_id = c.user_id and o.user_id is not null and o.customer_id is null;
update public.subscriptions   o set customer_id = c.id from public.customers c where o.user_id = c.user_id and o.user_id is not null and o.customer_id is null;

-- 4c. guest packs + deliveries carry a real phone → resolve them (folds duplicates by phone).
do $$
declare r record; cid uuid;
begin
  for r in select id, name, phone from public.drop_orders     where user_id is null and customer_id is null and phone is not null loop
    cid := public.resolve_customer(null, r.phone, null, r.name);
    update public.drop_orders set customer_id = cid where id = r.id;
  end loop;
  for r in select id, name, phone from public.delivery_orders where user_id is null and customer_id is null and phone is not null loop
    cid := public.resolve_customer(null, r.phone, null, r.name);
    update public.delivery_orders set customer_id = cid where id = r.id;
  end loop;
end $$;

-- verify:
--   select count(*) as customers from public.customers;
--   select count(*) filter (where customer_id is not null) as linked, count(*) as total from public.delivery_orders;
--   select proname from pg_proc where proname = 'resolve_customer';   -- 1 row
