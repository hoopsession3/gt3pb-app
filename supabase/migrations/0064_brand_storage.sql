-- 0064 — brand logo uploads: a public Storage bucket + policies so staff can upload logos/assets
-- from the app (saved into brand_assets). Apply after 0058. Idempotent.

insert into storage.buckets (id, name, public) values ('brand', 'brand', true)
on conflict (id) do nothing;

drop policy if exists "brand assets public read" on storage.objects;
create policy "brand assets public read" on storage.objects for select using (bucket_id = 'brand');

drop policy if exists "brand assets staff write" on storage.objects;
create policy "brand assets staff write" on storage.objects for all to authenticated
  using (bucket_id = 'brand' and (select public.is_staff()))
  with check (bucket_id = 'brand' and (select public.is_staff()));
