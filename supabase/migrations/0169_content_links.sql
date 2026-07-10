-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0169 · CONTENT LINKS — a post ties to events, truck stops, AND marketing plays, many-to-many
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The taxonomy spine for content: one piece can promote an event, run at a truck stop, and serve
-- a strategy play at the same time — and reporting can walk any of those edges. Two parts:
--   1. content_items.stop_id — heals a LATENT BUG: the Studio link picker has persisted stop_id
--      for weeks, but the column never existed (silent 400s). event_id/stop_id stay as the
--      PRIMARY link (calendar + campaign flows read them).
--   2. content_links — the many-to-many: event XOR stop XOR play per row (0040/0049's house
--      pattern), play identified by its locked Playbook name.

alter table public.content_items add column if not exists stop_id uuid references public.stops(id) on delete set null;

create table if not exists public.content_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  content_id uuid not null references public.content_items(id) on delete cascade,
  event_id   uuid references public.events(id) on delete cascade,
  stop_id    uuid references public.stops(id)  on delete cascade,
  play_key   text,
  created_at timestamptz not null default now(),
  constraint content_links_one_target
    check (((event_id is not null)::int + (stop_id is not null)::int + (play_key is not null)::int) = 1)
);
create index if not exists content_links_content on public.content_links(content_id);
create unique index if not exists content_links_uniq_event on public.content_links(content_id, event_id) where event_id is not null;
create unique index if not exists content_links_uniq_stop  on public.content_links(content_id, stop_id)  where stop_id  is not null;
create unique index if not exists content_links_uniq_play  on public.content_links(content_id, play_key) where play_key is not null;

alter table public.content_links enable row level security;
drop policy if exists "content_links staff all" on public.content_links;
create policy "content_links staff all" on public.content_links
  for all using ((select public.is_staff())) with check ((select public.is_staff()));

drop trigger if exists stamp_tenant_tg on public.content_links;
create trigger stamp_tenant_tg before insert on public.content_links for each row execute function public.stamp_tenant();
drop policy if exists "tenant isolation" on public.content_links;
create policy "tenant isolation" on public.content_links as restrictive for all
  using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

-- backfill: every existing primary event link becomes a link row (idempotent via the unique index)
insert into public.content_links (content_id, event_id)
  select id, event_id from public.content_items where event_id is not null
on conflict do nothing;

-- verify:
--   select count(*) from information_schema.columns where table_name = 'content_items' and column_name = 'stop_id'; -- 1
--   select count(*) from pg_policies where tablename = 'content_links';   -- 2
--   select count(*) from public.content_links;                            -- >= count of linked content
