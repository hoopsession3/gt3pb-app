-- 0260 · ADMIN AUDIT TRAIL (2026-08-01 — enterprise round P1, Ryan: "fix all and improve").
-- The one enterprise capability the control room lacked: WHO changed WHICH price, copy line,
-- deal, budget, or role — WHEN, with the before/after. The Maintenance log tracks review runs;
-- this tracks admin edits. Row-level triggers on the hot admin tables write one line per change
-- with a human-readable diff; admins read it in Settings › Change log.
--
-- Scope deliberately: products, deals, budgets, site_copy — the money-shaped knobs — plus
-- profiles ROLE changes only (not every profile save; role is the permission edit that matters).
-- security definer so the log can never be blocked by the editing user's own RLS view.

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor      uuid,                                -- auth.uid() at write time; null = system/service
  action     text not null,                       -- INSERT / UPDATE / DELETE
  table_name text not null,
  row_pk     text,
  summary    text,                                -- "price_cents: 1000 → 1200 · active: true → false"
  old_row    jsonb,
  new_row    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;
do $$ begin
  drop policy if exists "audit admin read" on public.admin_audit;
  create policy "audit admin read" on public.admin_audit for select using ((select public.is_admin()));
exception when others then null; end $$;
-- no insert/update/delete policies: only the definer trigger writes; nobody edits history.

create or replace function public.log_admin_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk   text;
  diff text;
begin
  if (tg_op = 'UPDATE') then
    select string_agg(format('%s: %s → %s', key, coalesce(o.value, '∅'), coalesce(n.value, '∅')), ' · ' order by key)
      into diff
      from jsonb_each_text(to_jsonb(old)) as o(key, value)
      full join jsonb_each_text(to_jsonb(new)) as n(key, value) using (key)
     where o.value is distinct from n.value
       and key not in ('updated_at', 'created_at');
    if diff is null then return new; end if;   -- timestamp-only touch → not a change worth a line
  end if;
  pk := coalesce(
    to_jsonb(coalesce(new, old)) ->> 'id',
    to_jsonb(coalesce(new, old)) ->> 'key',
    to_jsonb(coalesce(new, old)) ->> 'category',
    to_jsonb(coalesce(new, old)) ->> 'product_key');
  insert into public.admin_audit (actor, action, table_name, row_pk, summary, old_row, new_row)
  values (auth.uid(), tg_op, tg_table_name, pk, diff,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['products', 'deals', 'budgets', 'site_copy'] loop
    begin
      execute format('drop trigger if exists audit_%I on public.%I', t, t);
      execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.log_admin_audit()', t, t);
    exception when undefined_table then null;   -- a tenant without the table just skips it
    end;
  end loop;
end $$;

-- profiles: ROLE changes only — the permission edit that matters, without logging every avatar save.
do $$ begin
  drop trigger if exists audit_profiles_role on public.profiles;
  create trigger audit_profiles_role after update on public.profiles
    for each row when (old.role is distinct from new.role)
    execute function public.log_admin_audit();
exception when undefined_table or undefined_column then null; end $$;

-- Verify (prod, after apply):
--   update public.budgets set monthly_limit_cents = monthly_limit_cents where false;  -- no-op, no rows
--   select count(*) from public.admin_audit;                                          -- exists, readable as admin
