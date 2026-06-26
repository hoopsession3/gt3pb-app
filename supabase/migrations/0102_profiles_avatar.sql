-- 0102 — team culture: profiles get an avatar, a title, and a short bio, plus an 'avatars' storage
-- bucket. Powers the user profile + the dynamic org chart. Anyone can read avatars (public bucket);
-- a signed-in user can only write/replace files in their OWN folder (path = <uid>/...).

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists title      text;   -- e.g. "Lead Operator", "Co-Founder"
alter table public.profiles add column if not exists bio        text;
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (char_length(coalesce(bio,'')) <= 600);

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars public read"  on storage.objects;
create policy "avatars public read"  on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars own write"   on storage.objects;
create policy "avatars own write"   on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own update"  on storage.objects;
create policy "avatars own update"  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own delete"  on storage.objects;
create policy "avatars own delete"  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
