-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0181 · OPS PRIVACY — move crew-only fields off the world-readable events/stops rows
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- events and stops are SELECT `using (true)` (public on purpose — the Truck/Menu/Events surfaces
-- read them as guests). But three internal fields were later bolted onto those same public rows:
--   crew_brief (up to 4000 chars of run-of-show), dress_code, recap (after-action).
-- RLS is ROW-level: a column sitting on a world-readable row cannot be hidden by any policy, so a
-- not-signed-in visitor can `select crew_brief, dress_code, recap from events`. That is internal
-- ops/process/procedure text leaking to anon (and to plain members).
--
-- Fix: relocate the three fields into sibling tables (event_ops / stop_ops) gated by is_staff().
-- The public rows keep only public columns; the crew reads/writes the ops rows. Additive + a
-- one-time backfill; the only destructive step is dropping the three now-migrated columns, which
-- have no DB dependents (no view/trigger/function references them — verified).

-- ── 1. sibling tables (staff-only). Keyed 1:1 to the parent; cascade-delete with it. ────────────
create table if not exists public.event_ops (
  event_id   uuid primary key references public.events(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  crew_brief text,
  dress_code text,
  recap      text,
  updated_at timestamptz not null default now(),
  constraint event_ops_brief_len check (char_length(coalesce(crew_brief, '')) <= 4000),
  constraint event_ops_dress_len check (char_length(coalesce(dress_code, '')) <= 600)
);
create table if not exists public.stop_ops (
  stop_id    uuid primary key references public.stops(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  crew_brief text,
  dress_code text,
  recap      text,
  updated_at timestamptz not null default now(),
  constraint stop_ops_brief_len check (char_length(coalesce(crew_brief, '')) <= 4000),
  constraint stop_ops_dress_len check (char_length(coalesce(dress_code, '')) <= 600)
);

-- ── 2. backfill from the parent rows (only rows that actually carry any of the three). Idempotent
--       via ON CONFLICT; tenant_id fills from the column default (founding tenant today). ────────
insert into public.event_ops (event_id, crew_brief, dress_code, recap)
  select id, crew_brief, dress_code, recap from public.events
  where crew_brief is not null or dress_code is not null or recap is not null
  on conflict (event_id) do nothing;
insert into public.stop_ops (stop_id, crew_brief, dress_code, recap)
  select id, crew_brief, dress_code, recap from public.stops
  where crew_brief is not null or dress_code is not null or recap is not null
  on conflict (stop_id) do nothing;

-- ── 3. RLS: staff-only (the whole point) + the standard tenant-isolation belt (matches 0153). ───
do $$
declare t text;
begin
  foreach t in array array['event_ops', 'stop_ops'] loop
    execute format('revoke all on public.%I from anon', t);                                    -- no guest access at all
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);   -- staff pass RLS below
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "ops staff" on public.%I', t);
    execute format('create policy "ops staff" on public.%I for all using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('drop trigger if exists stamp_tenant_tg on public.%I', t);
    execute format('create trigger stamp_tenant_tg before insert on public.%I for each row execute function public.stamp_tenant()', t);
    execute format('drop policy if exists "tenant isolation" on public.%I', t);
    execute format('create policy "tenant isolation" on public.%I as restrictive for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant())', t);
  end loop;
end $$;

-- ── 4. remove the migrated columns from the PUBLIC rows (this is what closes the leak). The
--       per-column length CHECK constraints (0093) drop automatically with their columns. ────────
alter table public.events drop column if exists crew_brief;
alter table public.events drop column if exists dress_code;
alter table public.events drop column if exists recap;
alter table public.stops  drop column if exists crew_brief;
alter table public.stops  drop column if exists dress_code;
alter table public.stops  drop column if exists recap;

-- verify:
--   select to_regclass('public.event_ops'), to_regclass('public.stop_ops');                 -- both non-null
--   select count(*) from information_schema.columns where table_name='events' and column_name in ('crew_brief','dress_code','recap');  -- 0
--   select count(*) from information_schema.columns where table_name='stops'  and column_name in ('crew_brief','dress_code','recap');  -- 0
--   set role anon; select crew_brief from public.event_ops;  -- permission denied (anon has no grant)
