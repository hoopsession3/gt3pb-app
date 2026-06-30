-- 0112 — multiple media per content piece (carousel) + keep the single cover columns in sync for
-- the grid. `media` is an ordered array of { url, type } ('image'|'video'); media_url/media_type
-- mirror the first item (the cover) so existing reads keep working.
alter table public.content_items add column if not exists media jsonb not null default '[]';

-- backfill the array from any existing single media
update public.content_items
   set media = jsonb_build_array(jsonb_build_object('url', media_url, 'type', coalesce(media_type, 'image')))
 where media_url is not null and (media = '[]'::jsonb or media is null);
