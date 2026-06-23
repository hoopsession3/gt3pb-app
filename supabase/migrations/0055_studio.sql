-- 0055 — STUDIO: the collaborative marketing/content studio. content_items (the piece) +
-- content_versions (real history). Leadership/marketing tier (event_manager/admin/owner), same
-- audience as Plan. Real-time co-editing rides Supabase Realtime broadcast/presence (no DB change
-- needed for that); postgres_changes on content_items keeps the board live across users. Idempotent.

create table if not exists public.content_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  kind         text not null default 'post',         -- post | carousel | reel | caption | email | menu_card | promo | blog
  channel      text not null default 'instagram',    -- instagram | tiktok | site | email | print | other
  title        text not null default 'Untitled',
  hook         text,                                  -- the scroll-stopping first line
  caption      text,                                  -- the body copy
  hashtags     text[] not null default '{}',
  status       text not null default 'draft' check (status in ('draft','review','changes','approved','scheduled','published')),
  review_note  text,                                  -- latest "request changes" note
  scheduled_for timestamptz,
  event_id     uuid references public.events(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  approved_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists content_items_status on public.content_items(status);
create index if not exists content_items_sched  on public.content_items(scheduled_for);
create index if not exists content_items_tenant on public.content_items(tenant_id);

create table if not exists public.content_versions (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  title      text, hook text, caption text, hashtags text[],
  status     text,
  label      text,                                    -- edited | submitted | approved | changes | scheduled | published | restored
  edited_by  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists content_versions_item on public.content_versions(content_id, created_at desc);

-- updated_at trigger (reuse touch_updated_at from 0028)
drop trigger if exists content_items_touch on public.content_items;
create trigger content_items_touch before update on public.content_items
  for each row execute function public.touch_updated_at();

-- RLS: marketing/leadership tier = event_manager / admin / owner (same as Plan-section notes).
alter table public.content_items enable row level security;
drop policy if exists "content read"  on public.content_items;
create policy "content read"  on public.content_items for select
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "content write" on public.content_items;
create policy "content write" on public.content_items for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

alter table public.content_versions enable row level security;
drop policy if exists "content_versions read"  on public.content_versions;
create policy "content_versions read"  on public.content_versions for select
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));
drop policy if exists "content_versions write" on public.content_versions;
create policy "content_versions write" on public.content_versions for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

-- Live board across users (real-time). Presence + broadcast for co-editing need no publication.
do $$ begin
  alter publication supabase_realtime add table public.content_items;
exception when duplicate_object then null; end $$;
