-- 0090 — inventory ledger (append-only). The clean "On hand" UI is backed by a real ledger: every
-- confirm writes a signed delta entry, so the running balance per item is always correct AND the full
-- movement history is preserved for reports (plan vs actual, per-event consumption, leftovers,
-- carryover). The UI stays simple; the detail lives here.

create table if not exists public.inventory_ledger (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  item          text not null,                         -- item name (e.g. the prep line: '16oz bottles labeled')
  event_id      uuid references public.events(id) on delete set null,
  stop_id       uuid references public.stops(id)  on delete set null,
  task_id       uuid references public.event_tasks(id) on delete set null,
  kind          text not null default 'confirm',       -- plan | confirm | use | leftover | adjust | restock
  qty           numeric not null,                      -- signed delta: + adds to on hand, - removes
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists inventory_ledger_item_idx   on public.inventory_ledger(item);
create index if not exists inventory_ledger_event_idx  on public.inventory_ledger(event_id) where event_id is not null;
create index if not exists inventory_ledger_recent_idx on public.inventory_ledger(created_at desc);

alter table public.inventory_ledger enable row level security;
create policy inv_ledger_read   on public.inventory_ledger for select using (public.is_staff());
create policy inv_ledger_insert on public.inventory_ledger for insert with check (public.is_staff());

-- On-hand per item = running balance. A view makes reports trivial. security_invoker so the view
-- honors the querying user's RLS on inventory_ledger (no privilege leak).
create or replace view public.inventory_on_hand with (security_invoker = on) as
  select item, sum(qty) as on_hand, max(created_at) as last_movement
  from public.inventory_ledger group by item;
