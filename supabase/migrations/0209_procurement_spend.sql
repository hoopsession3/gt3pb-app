-- 0209 — Procurement / spend / budget. Money to date is revenue + COGS + P&L only; there was no way
-- to record what the business SPENDS or to track it against a budget (audit gap #7). This adds an
-- expense ledger (optionally tied to a real vendor from 0034 and/or an event) and a per-category
-- monthly budget, plus report_spend() for a spend-vs-budget roll-up. Staff-only, tenant-scoped.
-- Idempotent + additive.

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  vendor_id    uuid references public.vendors(id) on delete set null,
  category     text not null default 'other',
  description  text,
  amount_cents int  not null check (amount_cents >= 0),
  spent_on     date not null default current_date,
  event_id     uuid references public.events(id) on delete set null,
  status       text not null default 'paid' check (status in ('paid', 'pending')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists expenses_month_idx on public.expenses (spent_on desc);
create index if not exists expenses_cat_idx   on public.expenses (category);

create table if not exists public.budgets (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  category            text not null,
  monthly_limit_cents int  not null default 0 check (monthly_limit_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, category)
);

drop trigger if exists stamp_tenant_tg on public.expenses;
create trigger stamp_tenant_tg before insert on public.expenses for each row execute function public.stamp_tenant();
drop trigger if exists stamp_tenant_tg on public.budgets;
create trigger stamp_tenant_tg before insert on public.budgets for each row execute function public.stamp_tenant();

alter table public.expenses enable row level security;
alter table public.budgets  enable row level security;
drop policy if exists "expenses staff" on public.expenses;
create policy "expenses staff" on public.expenses for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "budgets staff" on public.budgets;
create policy "budgets staff" on public.budgets for all using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.expenses;
create policy "tenant isolation" on public.expenses as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
drop policy if exists "tenant isolation" on public.budgets;
create policy "tenant isolation" on public.budgets as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.budgets  to authenticated;

-- Spend vs budget for a month (defaults to the current month). Categories are the union of what's
-- budgeted and what's been spent, so nothing is hidden.
create or replace function public.report_spend(p_month date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mstart date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;
  return jsonb_build_object(
    'month', to_char(mstart, 'YYYY-MM'),
    'total_spent_cents',  coalesce((select sum(amount_cents) from expenses where spent_on >= mstart and spent_on < mend), 0),
    'total_budget_cents', coalesce((select sum(monthly_limit_cents) from budgets), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.category,
        'budget_cents', coalesce(b.monthly_limit_cents, 0),
        'spent_cents',  coalesce(s.spent, 0)
      ) order by coalesce(s.spent, 0) desc, c.category)
      from (select distinct category from (select category from budgets union all select category from expenses) u) c
      left join budgets b on b.category = c.category
      left join (select category, sum(amount_cents) spent from expenses where spent_on >= mstart and spent_on < mend group by category) s on s.category = c.category
    ), '[]'::jsonb)
  );
end $$;
grant execute on function public.report_spend(date) to authenticated;

-- Seed the standard spend categories at $0 so the panel opens with structure (editable).
insert into public.budgets (category, monthly_limit_cents)
select v.category, 0 from (values ('ingredients'),('supplies'),('equipment'),('marketing'),('fees'),('labor'),('other')) as v(category)
where not exists (select 1 from public.budgets b where b.category = v.category);

-- verify:
--   select to_regclass('public.expenses'), to_regclass('public.budgets');
--   select jsonb_pretty(public.report_spend());
