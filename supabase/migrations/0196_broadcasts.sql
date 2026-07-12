-- 0196 — Broadcasts: an operator-composed message/ad that appears LIVE across the app to all users
-- The industry-standard announcement bar: staff compose it, pick who sees it and how it looks, toggle
-- it live, and it appears for everyone in real time (added to the realtime publication) with an
-- optional call-to-action. Scheduling (starts_at/ends_at) auto-shows/hides it. Public rows are gated by
-- RLS so a guest only ever reads an ACTIVE, in-window, audience='all' broadcast — never a draft.

create table if not exists public.broadcasts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  title       text not null,
  body        text,
  kind        text not null default 'announcement' check (kind in ('announcement','promo','maintenance')),
  style       text not null default 'info'         check (style in ('info','success','warning','brand')),
  audience    text not null default 'all'          check (audience in ('all','members','staff')),
  cta_label   text,
  cta_href    text,
  active      boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint broadcast_title_len check (char_length(title) <= 120),
  constraint broadcast_body_len  check (char_length(coalesce(body,'')) <= 600)
);
create index if not exists broadcasts_active_idx on public.broadcasts (active, starts_at, ends_at) where active;

-- Live everywhere: the banner subscribes, so publishing/toggling shows for all users without a refresh.
do $$ begin alter publication supabase_realtime add table public.broadcasts; exception when duplicate_object then null; end $$;

-- Tenant stamp (house pattern).
drop trigger if exists stamp_tenant_tg on public.broadcasts;
create trigger stamp_tenant_tg before insert on public.broadcasts
  for each row execute function public.stamp_tenant();

alter table public.broadcasts enable row level security;

-- READ: staff see everything (to manage). Everyone else sees only an ACTIVE, in-window broadcast whose
-- audience they belong to — a guest gets audience='all'; a signed-in member also gets 'members'.
drop policy if exists "broadcast read" on public.broadcasts;
create policy "broadcast read" on public.broadcasts for select using (
  (select public.is_staff())
  or (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
    and (audience = 'all' or (audience = 'members' and (select auth.uid()) is not null))
  )
);
-- WRITE: staff only.
drop policy if exists "broadcast staff write" on public.broadcasts;
create policy "broadcast staff write" on public.broadcasts for all
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Tenant isolation (restrictive), matching every tenant_id table.
drop policy if exists "tenant isolation" on public.broadcasts;
create policy "tenant isolation" on public.broadcasts as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());

grant select, insert, update, delete on public.broadcasts to authenticated;
grant select on public.broadcasts to anon;

-- verify:
--   select to_regclass('public.broadcasts');  -- non-null
--   select relrowsecurity from pg_class where relname='broadcasts';  -- t
