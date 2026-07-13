-- 0203 — VIP verification (the committed launch deliverable): a bottle owner uploads a photo → it
-- lands in a staff moderation queue → staff verify → the customer becomes a VIP (tier 'founding',
-- which auto-grants the founding perks from 0176) and gets a reward. Mirrors the reviews-moderation
-- pattern (0131): member inserts own (pending), staff approve/reject. Photos go in a public 'vip'
-- bucket, per-user folder (same shape as avatars, 0102). Idempotent.

create table if not exists public.vip_verifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  photo_url   text not null,                                          -- the bottle-owner proof photo
  status      text not null default 'pending' check (status in ('pending','verified','rejected')),
  reward      text,                                                   -- what they got (e.g. 'free bottle'); staff-set on verify
  note        text,                                                   -- staff note (esp. on reject)
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists vip_status_idx on public.vip_verifications (status, created_at desc);
create index if not exists vip_user_idx   on public.vip_verifications (user_id);

drop trigger if exists stamp_tenant_tg on public.vip_verifications;
create trigger stamp_tenant_tg before insert on public.vip_verifications
  for each row execute function public.stamp_tenant();

alter table public.vip_verifications enable row level security;
-- A signed-in member submits their OWN proof (lands pending); they can see their own submissions.
drop policy if exists "vip insert own" on public.vip_verifications;
create policy "vip insert own" on public.vip_verifications for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "vip read own or staff" on public.vip_verifications;
create policy "vip read own or staff" on public.vip_verifications for select using (auth.uid() = user_id or (select public.is_staff()));
-- Staff moderate (verify / reject).
drop policy if exists "vip staff write" on public.vip_verifications;
create policy "vip staff write" on public.vip_verifications for update using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists "vip staff delete" on public.vip_verifications;
create policy "vip staff delete" on public.vip_verifications for delete using ((select public.is_staff()));
drop policy if exists "tenant isolation" on public.vip_verifications;
create policy "tenant isolation" on public.vip_verifications as restrictive
  for all using (tenant_id = public.effective_tenant()) with check (tenant_id = public.effective_tenant());
grant select, insert, update, delete on public.vip_verifications to authenticated;

-- The proof-photo bucket: public read (so staff + the member see it), member writes only into their own folder.
insert into storage.buckets (id, name, public) values ('vip', 'vip', true) on conflict (id) do nothing;
drop policy if exists "vip photos public read" on storage.objects;
create policy "vip photos public read" on storage.objects for select using (bucket_id = 'vip');
drop policy if exists "vip photos own insert" on storage.objects;
create policy "vip photos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vip' and (storage.foldername(name))[1] = auth.uid()::text);

-- verify:
--   select to_regclass('public.vip_verifications');
--   select id from storage.buckets where id = 'vip';
