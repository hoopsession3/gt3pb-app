-- 0097 — BREW BATCH ↔ EVENT/STOP, many-to-many. A single batch can serve more than one event or stop
-- (brew 7 gal of Flow → pour at two stops). brew_batches.event_id/stop_id stays as the PRIMARY target
-- (what the back-schedule date keys off); this join table holds every place the batch is served, so
-- each event/stop can show the batches coming to it.

create table if not exists public.brew_batch_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  batch_id   uuid not null references public.brew_batches(id) on delete cascade,
  event_id   uuid references public.events(id) on delete cascade,
  stop_id    uuid references public.stops(id)  on delete cascade,
  created_at timestamptz not null default now(),
  constraint bbl_one_owner check ((event_id is not null) <> (stop_id is not null))
);
create unique index if not exists bbl_batch_event on public.brew_batch_links(batch_id, event_id) where event_id is not null;
create unique index if not exists bbl_batch_stop  on public.brew_batch_links(batch_id, stop_id)  where stop_id  is not null;
create index if not exists bbl_event on public.brew_batch_links(event_id);
create index if not exists bbl_stop  on public.brew_batch_links(stop_id);

alter table public.brew_batch_links enable row level security;
create policy bbl_read  on public.brew_batch_links for select using (public.is_staff());
create policy bbl_write on public.brew_batch_links for all    using (public.is_admin()) with check (public.is_admin());

-- backfill the existing single links so nothing is lost
insert into public.brew_batch_links (batch_id, event_id)
select id, event_id from public.brew_batches where event_id is not null
on conflict do nothing;
insert into public.brew_batch_links (batch_id, stop_id)
select id, stop_id from public.brew_batches where stop_id is not null
on conflict do nothing;
