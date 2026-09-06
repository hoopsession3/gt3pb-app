-- 0278 — REAL PHOTOS AND VIDEO ON A PRODUCT, uploaded by the owner.
--
-- Until now the only way a product got a picture was pasting an Apliiq mockup URL into a text field:
-- someone else's render, hosted on someone else's CDN, and no way to show a clip of the thing moving.
-- This adds (a) a `media` column that can describe a photo OR a video, (b) a `shop` storage bucket
-- the owner can upload straight into, and (c) a backfill so every product that already has art keeps
-- it without anyone re-entering anything.
--
-- ZERO REGRESSION, deliberately: `image_url` and `images` are NOT dropped or changed. Five surfaces
-- still read them (shop grid, merch row thumbnail, Apliiq importer, checkout line, order email) and
-- the app keeps both in sync on every save (lib/shopMedia.ts toColumns()). A row written by the old
-- code still renders; a row written by the new code still renders in the old readers.
--
-- Apply after 0277.

-- ── the column ───────────────────────────────────────────────────────────────────────────────────
-- [{id, url, kind:'image'|'video', poster?, alt?}] — ordered; item 0 is the cover.
alter table public.shop_products add column if not exists media jsonb not null default '[]'::jsonb;

-- It must be an ARRAY, always. A bare object here would make every reader defensive forever, so the
-- shape is a constraint rather than a convention. (Named check so re-running is idempotent.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_products_media_is_array'
  ) then
    alter table public.shop_products
      add constraint shop_products_media_is_array check (jsonb_typeof(media) = 'array');
  end if;
end $$;

-- ── backfill: nobody re-enters art that already exists ───────────────────────────────────────────
-- Hero first, then the gallery, de-duplicated, all as images (the old columns could hold nothing
-- else). Only touches rows whose media is still empty, so this is safe to run more than once.
update public.shop_products p
set media = sub.media
from (
  select s.id,
         coalesce(
           jsonb_agg(distinct jsonb_build_object('id', u.url, 'url', u.url, 'kind', 'image'))
             filter (where u.url is not null and length(btrim(u.url)) > 0),
           '[]'::jsonb
         ) as media
  from public.shop_products s
  cross join lateral (
    select btrim(s.image_url) as url
    union all
    select btrim(x.value #>> '{}') from jsonb_array_elements(
      case when jsonb_typeof(s.images) = 'array' then s.images else '[]'::jsonb end
    ) as x(value)
  ) u
  where s.media = '[]'::jsonb
  group by s.id
) sub
where p.id = sub.id and p.media = '[]'::jsonb and sub.media <> '[]'::jsonb;

-- ── the bucket ───────────────────────────────────────────────────────────────────────────────────
-- Public read (these are storefront images — they're on a public product page either way), and a
-- 100 MB ceiling so a mis-picked 4K export fails at the edge instead of after a two-minute upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('shop', 'shop', true, 104857600)
on conflict (id) do update set public = true, file_size_limit = 104857600;

drop policy if exists "shop media public read" on storage.objects;
create policy "shop media public read" on storage.objects for select
  using (bucket_id = 'shop');

-- WRITE IS OWNER-ONLY, not staff. Storefront art is brand surface: it's the first thing a customer
-- sees and the last thing you want a shared crew login able to change. is_owner() is the same
-- sensitive tier already gating finance and role assignment (0023).
drop policy if exists "shop media owner write" on storage.objects;
create policy "shop media owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop' and (select public.is_owner()));
drop policy if exists "shop media owner update" on storage.objects;
create policy "shop media owner update" on storage.objects for update to authenticated
  using (bucket_id = 'shop' and (select public.is_owner()))
  with check (bucket_id = 'shop' and (select public.is_owner()));
drop policy if exists "shop media owner delete" on storage.objects;
create policy "shop media owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'shop' and (select public.is_owner()));

-- ── the record (no-drift gate) ───────────────────────────────────────────────────────────────────
insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('Real photos and video on the shop — shot by us, uploaded by us','feature','Ordering',
   'Products are no longer limited to a pasted mockup URL from the print partner. An owner can now upload actual photos and video clips straight from their phone or desktop, reorder them, choose which one leads, and write the alt text — and a shopper who taps a product gets a full-screen story: tap forward, tap back, video plays on its own. Every product that already had art keeps it, and everything that read the old picture fields still reads them, so nothing had to be re-entered and nothing else changed.',
   '2026-09-06', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

-- ── verify (run after) ────────────────────────────────────────────────────────────────────────────
--   -- the column exists and every row holds an array:
--   select count(*) as rows, count(*) filter (where jsonb_typeof(media) = 'array') as arrays
--   from public.shop_products;   -- expect: equal
--
--   -- the backfill carried the existing art across (media count >= 1 wherever there was a hero):
--   select id, title, image_url is not null as had_hero, jsonb_array_length(media) as items
--   from public.shop_products order by sort;
--
--   -- and it did NOT invent media for products that never had any:
--   select count(*) from public.shop_products where image_url is null
--     and coalesce(jsonb_array_length(images), 0) = 0 and jsonb_array_length(media) > 0;   -- expect: 0
--
--   -- the bucket is public-read, owner-write, capped:
--   select id, public, file_size_limit from storage.buckets where id = 'shop';
--   select policyname from pg_policies where tablename = 'objects' and policyname like 'shop media%';  -- 4
--
--   -- a non-owner cannot write (run as a server-role session): expect a policy violation
--   -- insert into storage.objects (bucket_id, name, owner) values ('shop','probe.jpg', auth.uid());
--
--   -- the shape guard actually refuses:
--   update public.shop_products set media = '{}'::jsonb where id = (select id from public.shop_products limit 1);  -- expect: EXCEPTION
