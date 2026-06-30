-- 0111 — let the Studio attach the actual post media (photo / video / reel) to a content piece, so
-- the feed/grid preview shows real content. A public 'content' bucket (staff-write) + the media URL
-- and type on content_items. The Instagram grid reads media_url first, then the Canva export.
alter table public.content_items add column if not exists media_url  text;
alter table public.content_items add column if not exists media_type text;  -- 'image' | 'video'

insert into storage.buckets (id, name, public) values ('content', 'content', true)
on conflict (id) do nothing;

drop policy if exists "content public read" on storage.objects;
create policy "content public read" on storage.objects for select using (bucket_id = 'content');
drop policy if exists "content staff write" on storage.objects;
create policy "content staff write" on storage.objects for insert to authenticated
  with check (bucket_id = 'content' and (select public.is_staff()));
drop policy if exists "content staff update" on storage.objects;
create policy "content staff update" on storage.objects for update to authenticated
  using (bucket_id = 'content' and (select public.is_staff())) with check (bucket_id = 'content' and (select public.is_staff()));
drop policy if exists "content staff delete" on storage.objects;
create policy "content staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'content' and (select public.is_staff()));
