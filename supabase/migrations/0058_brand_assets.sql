-- 0058 — BRAND ASSETS: a referenceable library of GT3's logos, wordmarks, taglines, icons & photos.
-- Seeded with the uploaded marks + everything already in /public. Any crew can reference; leadership
-- manages. Apply after 0057. Idempotent (unique per tenant+url).

create table if not exists public.brand_assets (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  label      text not null,
  kind       text not null default 'logo',   -- wordmark | logo | tagline | icon | photo
  url        text not null,
  notes      text,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, url)
);
create index if not exists brand_assets_tenant on public.brand_assets(tenant_id);

alter table public.brand_assets enable row level security;
drop policy if exists "brand_assets read"  on public.brand_assets;
create policy "brand_assets read"  on public.brand_assets for select using ((select public.is_staff()));
drop policy if exists "brand_assets write" on public.brand_assets;
create policy "brand_assets write" on public.brand_assets for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

insert into public.brand_assets (label, kind, url, notes, sort) values
  ('GT3 PB Wordmark',          'wordmark', '/gt3-pb-wordmark.png',            'Primary wordmark',                         10),
  ('Tagline on Red',           'tagline',  '/brand/pb-tagline-on-red.png',    'Tagline lockup on Signal Red',             20),
  ('Tagline — Red, transparent','tagline', '/brand/tagline-red-transparent.png','Red tagline, transparent background',     21),
  ('Performance Bar Handle',   'logo',     '/brand/gt3pb-handle.png',         'Social handle / badge mark',               30),
  ('Performance Bar Photo',    'photo',    '/brand/gt3pb-photo-01.jpg',       'Brand photography',                        40),
  ('App Icon',                 'icon',     '/icon-512.png',                   'App / favicon (512)',                      50),
  ('App Icon (SVG)',           'icon',     '/icon.svg',                       'Vector icon',                              51),
  ('Domain Card',              'logo',     '/gt3pb-domain.png',               'Domain / share card',                      60)
on conflict (tenant_id, url) do nothing;
