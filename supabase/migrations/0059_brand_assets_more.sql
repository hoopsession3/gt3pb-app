-- 0059 — more brand assets: GT3 Brew (sister-brand) marks + the World Cup soccer logos + bar photos.
-- Files live under public/brand/. Idempotent (unique tenant+url from 0058). Apply after 0058.

insert into public.brand_assets (label, kind, url, notes, sort) values
  ('GT3 Brew — Crown Wordmark', 'wordmark', '/brand/gt3-brew-crown.png',   'GT3 Brew (sister brand): crown over the 3, "Intentionally Crafted Beverages"', 70),
  ('GT3 Brew — World Cup',      'logo',     '/brand/gt3-brew-soccer.png',  'Soccer-ball mark + BREW — World Cup campaign',                                 71),
  ('GT3 — Soccer Badge',        'logo',     '/brand/gt3-soccer-badge.png', 'Soccer-ball badge — World Cup campaign',                                       72),
  ('Performance Bar Photo 01',  'photo',    '/brand/gt3pb-bar-01.png',     'Brand photography (PNG)',                                                      80),
  ('Performance Bar Photo 02',  'photo',    '/brand/gt3pb-bar-02.jpg',     'Brand photography',                                                            81)
on conflict (tenant_id, url) do nothing;
