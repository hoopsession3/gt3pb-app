-- 0193 — B2B joins the customer spine (audit P2 · CRM completeness)
-- Office accounts/orders were an island: business_accounts.customer_id was never populated,
-- business_orders had no customer_id at all, and neither appeared in all_orders — so the CRM's
-- lifetime value and history silently omitted an entire channel. Now the same resolve_customer (0151)
-- that links cup/pickup/delivery buyers links office buyers too, via triggers (resolve_customer is
-- service-role only, so a client insert can't call it — a SECURITY DEFINER trigger can). And all_orders
-- gains an 'office' channel so the office shows up everywhere the CRM reads. Purely additive.

alter table public.business_accounts add column if not exists customer_id uuid references public.customers(id);
alter table public.business_orders   add column if not exists customer_id uuid references public.customers(id);

-- Link an office ACCOUNT to its canonical customer the moment we have contact details.
create or replace function public.link_business_account_customer() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    new.customer_id := public.resolve_customer(new.user_id, new.contact_phone, new.contact_email, coalesce(new.contact_name, new.company));
  end if;
  return new;
end $$;
drop trigger if exists link_business_account_customer_tg on public.business_accounts;
create trigger link_business_account_customer_tg before insert or update of contact_phone, contact_email, user_id
  on public.business_accounts for each row execute function public.link_business_account_customer();

-- Link an office ORDER: inherit the account's customer if set, else resolve from the order's own contact.
create or replace function public.link_business_order_customer() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    if new.business_id is not null then
      select customer_id into new.customer_id from public.business_accounts where id = new.business_id;
    end if;
    if new.customer_id is null then
      new.customer_id := public.resolve_customer(new.user_id, new.contact_phone, null, coalesce(new.contact_name, new.company));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists link_business_order_customer_tg on public.business_orders;
create trigger link_business_order_customer_tg before insert on public.business_orders
  for each row execute function public.link_business_order_customer();

-- Backfill existing rows so history isn't stranded.
update public.business_accounts set customer_id = public.resolve_customer(user_id, contact_phone, contact_email, coalesce(contact_name, company)) where customer_id is null;
update public.business_orders o set customer_id = coalesce(
  (select customer_id from public.business_accounts a where a.id = o.business_id),
  public.resolve_customer(o.user_id, o.contact_phone, null, coalesce(o.contact_name, o.company))
) where customer_id is null;

-- Extend the unified order view with the office channel (matches the 0153 shape).
create or replace view public.all_orders with (security_invoker = on) as
  select 'cup'::text as channel, id, customer_id, user_id, tenant_id,
    case status when 'void' then 'canceled' when 'done' then 'fulfilled' when 'new' then 'placed' else 'in_prep' end as fulfillment_status,
    case when paid then 'paid' else 'pending' end as payment_status,
    total_cents, created_at
  from public.orders
  union all
  select 'pickup', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when picked_up then 'fulfilled' else 'placed' end,
    case when paid then 'paid' else 'pending' end,
    total_cents, created_at
  from public.drop_orders
  union all
  select 'delivery', id, customer_id, user_id, tenant_id,
    case
      when canceled_at is not null then 'canceled'
      when status = 'delivered' then 'fulfilled'
      when status = 'received' then 'placed'
      else 'in_prep'
    end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, created_at
  from public.delivery_orders
  union all
  select 'office', id, customer_id, user_id, tenant_id,
    case when canceled_at is not null then 'canceled' when status = 'delivered' then 'fulfilled' when status in ('received','brewed') then 'placed' else 'in_prep' end,
    case payment_status when 'paid' then 'paid' when 'refunded' then 'refunded' when 'failed' then 'failed' else 'pending' end,
    total_cents, created_at
  from public.business_orders;

-- verify:
--   select column_name from information_schema.columns where table_name='business_orders' and column_name='customer_id'; -- 1 row
--   select channel, count(*) from public.all_orders group by 1; -- includes 'office'
