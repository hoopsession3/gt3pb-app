-- 0292 — RECEIPTS, AND SPEND BROUGHT UP TO THE STANDARD EVERYTHING ELSE HOLDS. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- 0209 shipped expenses and budgets and then nothing came back to them. Measured against what the
-- rest of this database now does, they were missing seven things — and one of them is the entire
-- point of an expense system:
--
--   1. THERE ARE NO RECEIPTS. Not a file, not a reference, not a column. An expense table with no
--      receipt is a list of assertions. It is also the first thing an accountant asks for and the
--      thing a deduction actually rests on.
--   2. ANY STAFF MEMBER CAN HARD-DELETE AN EXPENSE. `grant delete … to authenticated`, no guard,
--      while customers, orders and agreements all got one in 0141 and 0280. The money record was
--      the least protected table in the database.
--   3. NO AUDIT TRIGGER. 0042 covered the other money tables. Spend was never added.
--   4. NO MARKET. Atlanta's spend and Greenville's are one number. 0291 tried to scope expenses by
--      market and skipped it, because there was no column to scope by.
--   5. CATEGORY IS FREE TEXT. budgets seeds seven categories; expenses.category is unconstrained, so
--      a typo silently creates an eighth that no budget covers and nothing rolls up into.
--   6. report_spend IGNORES THE TENANT. It is SECURITY DEFINER and sums every row in the table. The
--      same defect class 0215 fixed for inventory and 0288 fixed again for markets.
--   7. A BUDGET HAS NO MONTH. The column is called monthly_limit_cents and the unique key is
--      (tenant, category), so changing next month's budget rewrites every month that already
--      happened. You cannot answer "what did we plan in June" after you have edited it.
--
-- WHY THIS CAN BE THOROUGH RATHER THAN CAREFUL: production holds ZERO expenses today. Checked before
-- this was written. There is no backfill to be gentle with and no history to preserve, so the right
-- model can be built rather than approximated. The seven seeded budget rows are kept.
--
-- ONE DELIBERATE DIFFERENCE FROM 0278. The shop bucket is public — product photos are meant to be
-- seen. The receipts bucket is PRIVATE. A receipt carries a vendor, a price and often an address,
-- and none of that belongs on a public URL. Staff read, staff write, owners delete.
--
-- DELETING AN EXPENSE IS REPLACED BY VOIDING ONE. A deleted expense leaves no trace that it existed,
-- which is precisely what a book of record must not allow. void_expense() keeps the row, records who
-- and why, and takes it out of every total.
--
-- Apply after 0291.

-- ── 1. Categories become a thing, not a string ───────────────────────────────────────────────────
create table if not exists public.spend_categories (
  slug        text primary key,
  label       text not null,
  sort        int  not null default 0,
  active      boolean not null default true,
  -- The receipt rule lives with the category, because it differs by category in real life: a $4
  -- coffee for a customer is not a $400 piece of equipment. Null = a receipt is always wanted.
  receipt_required_over_cents int default 0,
  created_at  timestamptz not null default now()
);
alter table public.spend_categories enable row level security;
drop policy if exists "spend categories staff read" on public.spend_categories;
create policy "spend categories staff read" on public.spend_categories for select using ((select public.is_staff()));
drop policy if exists "spend categories owner write" on public.spend_categories;
create policy "spend categories owner write" on public.spend_categories for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
grant select on public.spend_categories to authenticated;

insert into public.spend_categories (slug, label, sort, receipt_required_over_cents) values
  ('ingredients', 'Ingredients',        10, 0),
  ('supplies',    'Supplies',           20, 0),
  ('equipment',   'Equipment',          30, 0),
  ('marketing',   'Marketing',          40, 2500),
  ('fees',        'Fees & software',    50, 0),
  ('labor',       'Labor',              60, 0),
  ('other',       'Other',              90, 0)
on conflict (slug) do nothing;

-- ── 2. The expense record grows up ───────────────────────────────────────────────────────────────
alter table public.expenses add column if not exists market text not null default 'greenville';
alter table public.expenses add column if not exists receipt_path text;
alter table public.expenses add column if not exists receipt_uploaded_at timestamptz;
alter table public.expenses add column if not exists receipt_by uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists updated_at timestamptz not null default now();
alter table public.expenses add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists voided_at timestamptz;
alter table public.expenses add column if not exists voided_by uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists void_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_market_fk') then
    alter table public.expenses add constraint expenses_market_fk
      foreign key (market) references public.markets(slug);
  end if;
  -- Any category already in use that is not seeded gets adopted, so the constraint can never fail
  -- on live data. With zero rows today this adopts nothing; it is here for the re-run.
  insert into public.spend_categories (slug, label, sort)
  select distinct e.category, initcap(replace(e.category, '_', ' ')), 80
    from public.expenses e
   where not exists (select 1 from public.spend_categories c where c.slug = e.category)
  on conflict (slug) do nothing;

  if not exists (select 1 from pg_constraint where conname = 'expenses_category_fk') then
    alter table public.expenses add constraint expenses_category_fk
      foreign key (category) references public.spend_categories(slug);
  end if;
end $$;

create index if not exists expenses_market_idx on public.expenses (market, spent_on desc);
create index if not exists expenses_open_idx   on public.expenses (spent_on desc) where voided_at is null;

comment on column public.expenses.receipt_path is
  'Object path in the PRIVATE receipts bucket. Private on purpose: a receipt carries a vendor, a price and often an address.';
comment on column public.expenses.voided_at is
  'A voided expense keeps its row and leaves every total. Expenses are never deleted — see guard_expense_delete.';

create or replace function public.touch_expense() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists zz_touch_expense on public.expenses;
create trigger zz_touch_expense before update on public.expenses
  for each row execute function public.touch_expense();

-- ── 3. A budget belongs to a month and a market ──────────────────────────────────────────────────
alter table public.budgets add column if not exists market text not null default 'greenville';
alter table public.budgets add column if not exists effective_from date not null default date '2000-01-01';
alter table public.budgets add column if not exists note text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budgets_market_fk') then
    alter table public.budgets add constraint budgets_market_fk
      foreign key (market) references public.markets(slug);
  end if;
  -- The old key was (tenant, category): one limit, forever, rewritten in place. Replacing it is what
  -- lets you ask what was planned in June after you have changed July.
  if exists (select 1 from pg_constraint where conname = 'budgets_tenant_id_category_key') then
    alter table public.budgets drop constraint budgets_tenant_id_category_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budgets_period_key') then
    alter table public.budgets add constraint budgets_period_key
      unique (tenant_id, market, category, effective_from);
  end if;
end $$;

-- ── 4. Expenses are voided, never deleted ────────────────────────────────────────────────────────
create or replace function public.guard_expense_delete() returns trigger
  language plpgsql as $$
begin
  if coalesce(current_setting('gt3.allow_hard_delete', true), '') = 'on' then return old; end if;
  raise exception 'Expenses are not deleted — void them instead, so the record of what was spent survives. (select public.void_expense(''%'', ''why''); ) Deliberate maintenance only: select set_config(''gt3.allow_hard_delete'',''on'',false); first.', old.id;
end $$;
drop trigger if exists guard_delete_expenses on public.expenses;
create trigger guard_delete_expenses before delete on public.expenses
  for each row execute function public.guard_expense_delete();

create or replace function public.void_expense(p_id uuid, p_reason text)
returns public.expenses language plpgsql security definer set search_path = public as $$
declare e public.expenses;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it is being voided — a void with no reason is the same problem as a delete.';
  end if;
  update public.expenses
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id and voided_at is null
   returning * into e;
  if not found then raise exception 'No such open expense.'; end if;
  return e;
end $$;
revoke all on function public.void_expense(uuid, text) from public;
grant execute on function public.void_expense(uuid, text) to authenticated;

-- ── 5. The audit trail catches up ────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['expenses','budgets','spend_categories'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ── 6. Receipts live in a PRIVATE bucket ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

drop policy if exists "receipts staff read" on storage.objects;
create policy "receipts staff read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (select public.is_staff()));

drop policy if exists "receipts staff write" on storage.objects;
create policy "receipts staff write" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (select public.is_staff()));

drop policy if exists "receipts owner delete" on storage.objects;
create policy "receipts owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (select public.is_owner()));

-- ── 7. The report tells the truth about tenant, market and voids ─────────────────────────────────
-- Rewritten from 0209's body. The shape of the answer is unchanged so the panel keeps working; what
-- changed is that it no longer sums other tenants' rows, it can answer for one city, it ignores
-- voided expenses, and it picks the budget that was in force for the month asked about rather than
-- whatever the budget says today.
create or replace function public.report_spend(p_month date default current_date, p_market text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mstart date := date_trunc('month', p_month)::date;
  mend   date := (date_trunc('month', p_month) + interval '1 month')::date;
  tid    uuid := public.effective_tenant();
begin
  if not public.is_staff() then return jsonb_build_object('error', 'unauthorized'); end if;

  return jsonb_build_object(
    'month', to_char(mstart, 'YYYY-MM'),
    'market', p_market,
    'total_spent_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is null
         and tenant_id = tid and (p_market is null or market = p_market)), 0),
    'total_budget_cents', coalesce((
      select sum(b.monthly_limit_cents) from (
        select distinct on (category, market) category, market, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market)
           and effective_from <= mstart
         order by category, market, effective_from desc
      ) b), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.slug,
        'label', c.label,
        'budget_cents', coalesce(b.monthly_limit_cents, 0),
        'spent_cents',  coalesce(s.spent, 0)
      ) order by coalesce(s.spent, 0) desc, c.sort, c.slug)
      from public.spend_categories c
      left join (
        select distinct on (category) category, monthly_limit_cents
          from budgets
         where tenant_id = tid and (p_market is null or market = p_market) and effective_from <= mstart
         order by category, effective_from desc
      ) b on b.category = c.slug
      left join (
        select category, sum(amount_cents) spent from expenses
         where spent_on >= mstart and spent_on < mend and voided_at is null
           and tenant_id = tid and (p_market is null or market = p_market)
         group by category
      ) s on s.category = c.slug
      where c.active or coalesce(s.spent, 0) > 0
    ), '[]'::jsonb),
    'voided_cents', coalesce((
      select sum(amount_cents) from expenses
       where spent_on >= mstart and spent_on < mend and voided_at is not null
         and tenant_id = tid and (p_market is null or market = p_market)), 0)
  );
end $$;
grant execute on function public.report_spend(date, text) to authenticated;

-- ── 8. What is missing a receipt, as a query ─────────────────────────────────────────────────────
-- The question an accountant asks, answered without anyone building a report for it.
create or replace view public.v_receipt_gaps as
select e.id, e.market, e.category, c.label as category_label,
       e.amount_cents, e.spent_on, e.description,
       (current_date - e.spent_on) as days_old,
       coalesce(c.receipt_required_over_cents, 0) as required_over_cents,
       case
         when e.amount_cents >= 50000 then 'over $500 with no receipt — get this one first'
         when current_date - e.spent_on > 90 then 'over 90 days old — memory of what it was is gone'
         else 'no receipt on file'
       end as why
  from public.expenses e
  left join public.spend_categories c on c.slug = e.category
 where e.voided_at is null
   and e.receipt_path is null
   and e.amount_cents >= coalesce(c.receipt_required_over_cents, 0)
 order by e.amount_cents desc, e.spent_on;

revoke all on public.v_receipt_gaps from public, anon;
grant select on public.v_receipt_gaps to authenticated;

comment on view public.v_receipt_gaps is
  'Open expenses that should have a receipt and do not, worst first. Empty is the goal; it is also what an accountant will ask you for.';

-- ── 9. Now that spend has a city, 0291's scope reaches it ────────────────────────────────────────
-- 0291 tried to apply "market scope" to expenses and budgets and skipped both, because neither had a
-- market column to scope by. They do now. Doing it here rather than telling someone to re-run 0291
-- keeps the lineage self-contained: applying these files in order, once, is always enough.
do $$
declare t text;
begin
  foreach t in array array['expenses','budgets'] loop
    execute format('drop policy if exists "market scope" on public.%I', t);
    execute format(
      'create policy "market scope" on public.%I as restrictive for select using (public.market_visible(market))', t
    );
  end loop;
end $$;

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Receipts, and spend that holds up','improvement','Money',
   'Expenses could be logged but a receipt could not be attached to one — which is the thing an accountant asks for and the thing a deduction rests on. Receipts now attach to an expense and are stored privately, because a receipt carries a vendor, a price and often an address. Alongside that: spend is recorded per city instead of one company-wide number, categories come from a fixed list so a typo cannot create a category nothing rolls up into, a budget belongs to a month so changing next month no longer rewrites what was planned last month, and every change to an expense is now in the audit trail. Expenses can no longer be deleted at all — they are voided with a reason, and the record of what was spent survives. There is a running list of anything missing a receipt, worst first.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the seven categories, and the receipt rule on each:
--   select slug, label, receipt_required_over_cents from public.spend_categories order by sort;
--
--   -- the report still answers, and now answers per city:
--   select jsonb_pretty(public.report_spend(current_date, 'greenville'));
--
--   -- nothing is missing a receipt yet, because nothing has been spent:
--   select count(*) from public.v_receipt_gaps;
--
--   -- deleting an expense is refused: expect EXCEPTION
--   -- delete from public.expenses where id = (select id from public.expenses limit 1);
