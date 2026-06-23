-- 0057 — BRAND KIT: GT3's logos, palette, fonts & voice, so the Studio carries the brand and
-- content is made on-brand. One row per tenant; seeded with GT3's real tokens (from the app's
-- design system + Academy). Leadership-managed (same tier as Studio). Apply after 0040. Idempotent.

create table if not exists public.brand_kit (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null unique references public.tenants(id) default '00000000-0000-0000-0000-000000000001',
  voice        text,
  tagline      text,
  logo_url     text,
  wordmark_url text,
  colors       jsonb not null default '[]'::jsonb,   -- [{ "name": "...", "hex": "#RRGGBB" }]
  fonts        jsonb not null default '[]'::jsonb,    -- [{ "role": "...", "name": "..." }]
  notes        text,
  updated_at   timestamptz not null default now()
);

drop trigger if exists brand_kit_touch on public.brand_kit;
create trigger brand_kit_touch before update on public.brand_kit for each row execute function public.touch_updated_at();

alter table public.brand_kit enable row level security;
drop policy if exists "brand read"  on public.brand_kit;
create policy "brand read"  on public.brand_kit for select using ((select public.is_staff()));  -- any crew can reference the brand
drop policy if exists "brand write" on public.brand_kit;
create policy "brand write" on public.brand_kit for all to authenticated
  using ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))))
  with check ((select exists (select 1 from public.profiles where id = auth.uid() and role in ('event_manager','admin','owner'))));

-- Seed GT3's real brand tokens (idempotent on tenant).
insert into public.brand_kit (tenant_id, voice, tagline, logo_url, wordmark_url, colors, fonts, notes)
values (
  '00000000-0000-0000-0000-000000000001',
  'Pure Signal. No Noise.',
  'Whole-food performance beverages — every input a named ingredient.',
  '/icon-512.png',
  '/gt3-pb-wordmark.png',
  $j$[
    {"name":"Signal Red","hex":"#B82420"},
    {"name":"Cream","hex":"#F5F1E8"},
    {"name":"Charcoal","hex":"#15120D"},
    {"name":"Gold","hex":"#A97C3F"},
    {"name":"Gold Light","hex":"#C8A661"}
  ]$j$::jsonb,
  $f$[
    {"role":"Display","name":"Archivo Black"},
    {"role":"Editorial","name":"Fraunces Italic"},
    {"role":"Headline serif","name":"Playfair Display Italic"},
    {"role":"Body","name":"Inter"},
    {"role":"Data","name":"DM Mono"}
  ]$f$::jsonb,
  'Premium, measured, education-first. Signal over noise. No hype, no fake urgency, no generic AI aesthetic.'
)
on conflict (tenant_id) do nothing;
