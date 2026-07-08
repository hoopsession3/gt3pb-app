-- 0142 — GOALS: the strategy's scoreboard. Paste into Supabase → SQL Editor → Run. Idempotent.
--
-- Owners and managers work goals together (Plan › Goals): a number, a date, the play it serves.
-- Threads reuse the comments engine via strategy_key ('goal:<id>') — no schema change needed.
-- Seeded from the locked strategy doc: the six Phase 1→2 trigger conditions become live goals,
-- so the checklist the doc commits to is a board, not a paragraph. Business records: audited
-- (0042 engine) + delete-guarded (0141 engine).

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title         text not null,
  metric        text,                    -- what we count, plain english
  unit          text not null default '',
  target_value  numeric not null check (target_value > 0),
  current_value numeric not null default 0,
  due_date      date,
  play          text,                    -- the GTM play / strategy block it serves
  source        text,                    -- traceability ("strategy doc Rev 1.0 · Phase 2 trigger")
  status        text not null default 'active' check (status in ('active','hit','missed','archived')),
  created_by    uuid references auth.users(id),
  author_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, title)
);
create index if not exists goals_status_idx on public.goals(status, due_date);
alter table public.goals enable row level security;

drop policy if exists "goals staff read" on public.goals;
create policy "goals staff read" on public.goals
  for select using ((select public.is_staff()));
-- leadership = owners AND managers, per the operating model ("worked between owners and managers")
drop policy if exists "goals leadership write" on public.goals;
create policy "goals leadership write" on public.goals
  for all using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  ) with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('owner','admin','event_manager') or p.is_admin))
  );

-- durability wiring (same engines as every business record)
drop trigger if exists audit_goals on public.goals;
create trigger audit_goals after insert or update or delete on public.goals
  for each row execute function public.audit_row();
drop trigger if exists guard_delete_goals on public.goals;
create trigger guard_delete_goals before delete on public.goals
  for each row execute function public.guard_customer_delete();

-- seed: the six Phase 1→2 trigger conditions, verbatim from the locked doc (Rev 1.0)
insert into public.goals (title, metric, unit, target_value, play, source) values
  ('Events per month',           'booked & served events, two months running', '/mo',    15,   'Farmers Market Rotation + partnerships', 'strategy doc Rev 1.0 · Phase 2 trigger'),
  ('Loop share of transactions', 'Loop refills as % of all transactions',      '%',      25,   'Why the bottle comes back',              'strategy doc Rev 1.0 · Phase 2 trigger'),
  ('Sunday orders per month',    'delivery orders fulfilled',                  '/mo',    15,   'Sunday Direct Delivery',                 'strategy doc Rev 1.0 · Phase 2 trigger'),
  ('Bottles in circulation',     'GT3 glass in customers'' hands',             'bottles', 300, 'Why the bottle comes back',              'strategy doc Rev 1.0 · Phase 2 trigger'),
  ('Bottles per month',          'total bottles sold, all channels',           '/mo',    1200, 'The money path',                         'strategy doc Rev 1.0 · Phase 2 trigger'),
  ('Monthly net, solo ceiling',  'net income at solo capacity',                '$/mo',   7000, 'The money path',                         'strategy doc Rev 1.0 · Phase 2 trigger')
on conflict (tenant_id, title) do nothing;

-- verify:
--   select count(*) from public.goals;                                                   -- >= 6
--   select count(*) from pg_policy where polrelid='public.goals'::regclass;              -- >= 2 (+1 after 0134 isolation re-run)
--   select count(*) from pg_trigger where tgrelid='public.goals'::regclass and not tgisinternal;  -- >= 2

-- tenancy convention (0134): stamp + restrictive isolation — applied with the migration
drop trigger if exists stamp_tenant_tg on public.goals;
create trigger stamp_tenant_tg before insert on public.goals for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.goals;
create policy "tenant isolation" on public.goals as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
