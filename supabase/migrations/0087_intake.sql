-- 0087 — smart intake: a private storage bucket for dropped files + a documents table.
-- Drop any file (photo of gear, a permit PDF, a receipt, a manual) and the intake agent reads it,
-- decides what it is, and files it: gear → assets, a consumable → inventory, paperwork → documents.

insert into storage.buckets (id, name, public) values ('intake', 'intake', false)
on conflict (id) do nothing;

drop policy if exists "intake staff all" on storage.objects;
create policy "intake staff all" on storage.objects for all to authenticated
  using (bucket_id = 'intake' and (select public.is_staff()))
  with check (bucket_id = 'intake' and (select public.is_staff()));

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title        text not null,
  kind         text not null default 'other',  -- permit | coi | contract | receipt | invoice | manual | recipe | compliance | photo | other
  summary      text,
  storage_path text,                            -- path in the 'intake' bucket
  file_name    text,
  mime         text,
  tags         text[] not null default '{}',
  event_id     uuid references public.events(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists documents_kind_idx   on public.documents(kind);
create index if not exists documents_recent_idx  on public.documents(created_at desc);

alter table public.documents enable row level security;
create policy documents_read   on public.documents for select using (public.is_staff());
create policy documents_insert on public.documents for insert with check (public.is_staff());
create policy documents_update on public.documents for update using (public.is_staff()) with check (public.is_staff());
create policy documents_delete on public.documents for delete using (public.is_staff());
