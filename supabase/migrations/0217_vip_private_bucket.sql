-- 0217 — VIP proof photos go private. The 0203 'vip' bucket was public (mirroring avatars), but a
-- bottle-owner proof is a person's photo — possibly a face, possibly their home. Anyone with the URL
-- could view it. Now: the bucket is private; staff read via signed URLs (VipQueue), and a member can
-- read their own folder. Existing rows keep their stored URL string — the client extracts the storage
-- path from it and signs. Idempotent.

update storage.buckets set public = false where id = 'vip';

drop policy if exists "vip photos public read" on storage.objects;
drop policy if exists "vip photos staff read" on storage.objects;
create policy "vip photos staff read" on storage.objects for select to authenticated
  using (bucket_id = 'vip' and (select public.is_staff()));
drop policy if exists "vip photos own read" on storage.objects;
create policy "vip photos own read" on storage.objects for select to authenticated
  using (bucket_id = 'vip' and (storage.foldername(name))[1] = auth.uid()::text);

-- verify:
--   select public from storage.buckets where id = 'vip';                                            -- false
--   select policyname from pg_policies where tablename='objects' and policyname like 'vip photos%'; -- staff read, own read, own insert
