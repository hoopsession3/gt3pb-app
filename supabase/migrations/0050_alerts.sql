-- 0050 — alerts spine: a tenant-scoped, severity-tiered, acknowledgeable alert inbox.
-- One row per "thing you might need to know." Producers (assignment between leaders, flagged
-- follow-ups, bookings, truck/money/prep signals) insert rows; the `push` Edge Function fans
-- each out to the chosen channels (Teams webhook + web push). The in-app inbox reads this table
-- in realtime and lets leadership acknowledge. Idempotent. Apply after 0049.

create table if not exists public.alerts (
  id             uuid primary key default gen_random_uuid(),
  severity       text not null default 'important' check (severity in ('critical','important','fyi')),
  category       text,                                                    -- 'assignment','booking','truck','money','prep','note','dev'
  title          text not null,
  body           text,
  link           text default '/admin',                                   -- in-app deep link
  target_user_id uuid references auth.users(id) on delete cascade,        -- who it's for (null = all leadership)
  created_by     uuid references auth.users(id) on delete set null,
  ack_at         timestamptz,
  ack_by         uuid references auth.users(id) on delete set null,
  escalate_after_min int,                                                 -- reserved: re-ping window for criticals (cron, future)
  escalated_at   timestamptz,
  channels_sent  text[] not null default '{}',                            -- audit of which channels fired
  tenant_id      uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  created_at     timestamptz not null default now()
);
create index if not exists alerts_open    on public.alerts(created_at desc) where ack_at is null;
create index if not exists alerts_target   on public.alerts(target_user_id);
create index if not exists alerts_tenant_idx on public.alerts(tenant_id);

alter table public.alerts enable row level security;

-- Leadership tier = event_manager / admin / owner (same audience as notes + the Plan section).
-- Scalar-subquery wrap keeps the RLS plan stable under PostgREST (the 0039 lesson).
drop policy if exists "alerts leadership read" on public.alerts;
create policy "alerts leadership read" on public.alerts for select
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "alerts leadership insert" on public.alerts;
create policy "alerts leadership insert" on public.alerts for insert to authenticated
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "alerts leadership update" on public.alerts;
create policy "alerts leadership update" on public.alerts for update
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

do $$ begin
  alter publication supabase_realtime add table public.alerts;
exception when duplicate_object then null; end $$;
